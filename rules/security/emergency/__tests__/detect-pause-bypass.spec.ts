import { detectPauseBypass } from '../detect-pause-bypass';

const kinds = (src: string, opts?: Parameters<typeof detectPauseBypass>[1]) =>
  detectPauseBypass(src, opts).findings.map((f) => `${f.function}:${f.kind}`);

const DIRECT = `
pragma solidity ^0.8.20;
contract Vault is Pausable {
  mapping(address => uint256) public balances;
  function deposit() external payable whenNotPaused { balances[msg.sender] += msg.value; }
  function withdraw(uint256 amt) external {
    balances[msg.sender] -= amt;
    payable(msg.sender).transfer(amt);
  }
}`;

/** The internal sink is reached by a guarded and an unguarded entry point. */
const CROSS_FUNCTION = `
pragma solidity ^0.8.20;
contract Vault is Pausable {
  mapping(address => uint256) public balances;
  function withdraw(uint256 a) external whenNotPaused { _withdraw(msg.sender, a); }
  function withdrawTo(address to, uint256 a) external { _withdraw(to, a); }
  function _withdraw(address to, uint256 a) internal {
    balances[msg.sender] -= a;
    payable(to).transfer(a);
  }
}`;

const INHERITED_ENTRY = `
pragma solidity ^0.8.20;
abstract contract Base {
  mapping(address => uint256) public balances;
  function withdraw(uint256 a) public virtual { balances[msg.sender] -= a; payable(msg.sender).transfer(a); }
}
contract Vault is Base, Pausable {
  function deposit() external payable whenNotPaused { balances[msg.sender] += msg.value; }
}`;

const INHERITED_OVERRIDE_GUARDED = `
pragma solidity ^0.8.20;
abstract contract Base {
  mapping(address => uint256) public balances;
  function withdraw(uint256 a) public virtual { balances[msg.sender] -= a; payable(msg.sender).transfer(a); }
}
contract Vault is Base, Pausable {
  function withdraw(uint256 a) public override whenNotPaused { super.withdraw(a); }
}`;

const INHERITED_MODIFIER_WEAKENED = `
pragma solidity ^0.8.20;
contract Base {
  bool public paused;
  modifier whenActive() virtual { require(!paused, "paused"); _; }
  function pause() external { paused = true; }
}
contract Vault is Base {
  mapping(address => uint256) public balances;
  modifier whenActive() override { _; }
  function withdraw(uint256 a) external whenActive { balances[msg.sender] -= a; payable(msg.sender).transfer(a); }
}`;

const CALLBACK = `
pragma solidity ^0.8.20;
contract Pool is Pausable {
  mapping(address => uint256) public shares;
  function swap(uint256 a) external whenNotPaused { shares[msg.sender] += a; }
  function onFlashLoan(address i, address t, uint256 a, uint256 f, bytes calldata d) external returns (bytes32) {
    shares[i] += a;
    return keccak256("ok");
  }
}`;

describe('detectPauseBypass', () => {
  it('flags an unguarded withdrawal in a pausable contract', () => {
    const r = detectPauseBypass(DIRECT);
    expect(r.findings).toHaveLength(1);
    const f = r.findings[0];
    expect(f).toMatchObject({ ruleId: 'GG-PAUSE-BYPASS-001', kind: 'unpaused-entry-point', function: 'withdraw', severity: 'high' });
    expect(r.inventory.map((e) => `${e.function}:${e.status}`).sort()).toEqual(['deposit:enforced', 'withdraw:missing']);
  });

  it('catches an unguarded sibling of a guarded entry point and cites the shared sink', () => {
    const [f] = detectPauseBypass(CROSS_FUNCTION).findings;
    expect(f.kind).toBe('cross-function-pause-gap');
    expect(f.function).toBe('withdrawTo');
    expect(f.confidence).toBe('high');
    expect(f.details).toMatchObject({ guardedSiblings: ['withdraw'] });
  });

  it('reports an inherited entry point that the pausable contract never guards', () => {
    expect(kinds(INHERITED_ENTRY)).toEqual(['withdraw:inherited-entry-point-unpaused']);
  });

  it('accepts an override that adds the guard and calls super', () => {
    expect(kinds(INHERITED_OVERRIDE_GUARDED)).toEqual([]);
  });

  it('notices an overridden modifier that no longer checks the pause flag', () => {
    expect(kinds(INHERITED_MODIFIER_WEAKENED)).toEqual(['withdraw:unpaused-entry-point']);
  });

  it('flags callbacks that change state while paused', () => {
    expect(kinds(CALLBACK)).toEqual(['onFlashLoan:callback-bypasses-pause']);
  });

  it('honours documented, configured and default exemptions', () => {
    const doc = DIRECT.replace('  function withdraw', '  // gasguard-pause-exempt: users must always be able to exit\n  function withdraw');
    expect(kinds(doc)).toEqual([]);
    expect(kinds(DIRECT, { exemptFunctions: ['withdraw'] })).toEqual([]);
    expect(kinds(DIRECT.replace('withdraw', 'emergencyWithdraw'))).toEqual([]);
    expect(kinds(DIRECT.replace('withdraw(uint256 amt) external', 'withdraw(uint256 amt) external whenPaused'))).toEqual([]);
  });

  it('downgrades privileged functions and can omit them', () => {
    const owner = DIRECT.replace('withdraw(uint256 amt) external', 'withdraw(uint256 amt) external onlyOwner');
    const [f] = detectPauseBypass(owner).findings;
    expect(f.kind).toBe('privileged-operation-unpaused');
    expect(f.severity).toBe('medium');
    expect(kinds(owner, { includePrivileged: false })).toEqual([]);
  });

  it('skips contracts without a pause mechanism', () => {
    const plain = DIRECT.replace(' is Pausable', '').replace(' whenNotPaused', '');
    expect(detectPauseBypass(plain).findings).toEqual([]);
  });

  it('extends the inventory through validated options and ignores unsafe patterns', () => {
    const src = DIRECT.replace('withdraw', 'settle').replace('balances[msg.sender] -= amt;\n    payable(msg.sender).transfer(amt);', 'x = 1;');
    expect(kinds(src, { operations: [{ category: 'settle', namePattern: '^settle' }] })).toEqual(['settle:unpaused-entry-point']);
    const r = detectPauseBypass(DIRECT, { exemptPatterns: ['(a+)+$', '['] });
    expect(r.diagnostics.filter((d) => d.code === 'invalid-option')).toHaveLength(2);
    expect(r.findings).toHaveLength(1);
  });

  it('fails safely on malformed input', () => {
    for (const bad of ['', 42, 'not solidity']) {
      const r = detectPauseBypass(bad);
      expect(r.analyzed).toBe(false);
      expect(r.diagnostics.length).toBeGreaterThan(0);
    }
  });
});
