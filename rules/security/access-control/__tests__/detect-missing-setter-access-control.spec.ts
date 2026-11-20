import { detectMissingSetterAccessControl } from '../detect-missing-setter-access-control';

const run = (src: string, opts?: Parameters<typeof detectMissingSetterAccessControl>[1]) => detectMissingSetterAccessControl(src, opts);
const kinds = (src: string, opts?: Parameters<typeof detectMissingSetterAccessControl>[1]) =>
  run(src, opts).findings.map((f) => `${f.function}:${f.kind}:${f.severity}`);

const HEAD = `pragma solidity ^0.8.20;
contract Vault {
  address public owner;
  bool public paused;
  uint256 public feeBps;
  address public treasury;
  address public oracle;
  uint256 public maxDeposit;
  mapping(address => bool) public admins;
  mapping(address => uint256) public slippage;
  modifier onlyOwner() { require(msg.sender == owner, "no"); _; }
`;

describe('detectMissingSetterAccessControl', () => {
  it('flags unprotected pause, fee, destination, integration and limit setters', () => {
    const src = `${HEAD}
  function setPaused(bool p) external { paused = p; }
  function setFee(uint256 f) external { feeBps = f; }
  function setTreasury(address t) external { treasury = t; }
  function setOracle(address o) external { oracle = o; }
  function setMaxDeposit(uint256 m) external { maxDeposit = m; }
}`;
    expect(kinds(src)).toEqual([
      'setPaused:unrestricted-config-setter:critical',
      'setFee:unrestricted-config-setter:high',
      'setTreasury:unrestricted-config-setter:critical',
      'setOracle:unrestricted-config-setter:critical',
      'setMaxDeposit:unrestricted-config-setter:high',
    ]);
    const f = run(src).findings[0];
    expect(f.confidence).toBe('high');
    expect(f.confidenceEvidence.join(' ')).toContain('write to paused');
  });

  it('accepts resolved modifiers, inline checks, helpers, allow-lists and unresolved onlyOwner', () => {
    const src = `${HEAD}
  function _checkAdmin() internal view { require(admins[msg.sender], "no"); }
  function setPaused(bool p) external onlyOwner { paused = p; }
  function setFee(uint256 f) external { require(msg.sender == owner); feeBps = f; }
  function setTreasury(address t) external { _checkAdmin(); treasury = t; }
  function setOracle(address o) external { require(admins[msg.sender]); oracle = o; }
}
contract Other is Ownable { address public router; function setRouter(address r) external onlyOwner { router = r; } }`;
    const r = run(src);
    expect(r.findings).toEqual([]);
    expect(r.inventory.every((e) => e.status === 'restricted')).toBe(true);
  });

  it('resolves modifiers inherited from a base in the same source', () => {
    const src = `pragma solidity ^0.8.20;
abstract contract Auth { address public owner; modifier onlyOwner() virtual { require(msg.sender == owner); _; } }
contract Vault is Auth { uint256 public feeBps; function setFee(uint256 f) external onlyOwner { feeBps = f; } }`;
    expect(kinds(src)).toEqual([]);
  });

  it('reports a setter whose inherited modifier was overridden with no check', () => {
    const src = `pragma solidity ^0.8.20;
abstract contract Auth { address public owner; modifier onlyOwner() virtual { require(msg.sender == owner); _; } }
contract Vault is Auth {
  uint256 public feeBps;
  modifier onlyOwner() override { _; }
  function setFee(uint256 f) external onlyOwner { feeBps = f; }
}`;
    expect(kinds(src)).toEqual(['setFee:unrestricted-config-setter:high']);
  });

  it('treats tx.origin and parameter comparisons as ineffective', () => {
    const src = `${HEAD}
  function setFee(uint256 f) external { require(tx.origin == owner); feeBps = f; }
  function setTreasury(address t, address caller) external { require(msg.sender == caller); treasury = t; }
}`;
    const r = run(src);
    expect(r.findings.map((f) => f.kind)).toEqual(['ineffective-access-control', 'ineffective-access-control']);
    expect(r.findings[0].confidence).toBe('medium');
    expect(r.findings[0].message).toContain('tx.origin');
  });

  it('follows an unguarded external setter into an internal one', () => {
    const src = `${HEAD}
  function setFee(uint256 f) external { _setFee(f); }
  function _setFee(uint256 f) internal { feeBps = f; }
}`;
    const [f] = run(src).findings;
    expect(f.function).toBe('setFee');
    expect(f.confidence).toBe('medium');
    expect(f.details).toMatchObject({ stateVariable: 'feeBps' });
  });

  it('separates view functions, per-caller settings and documented permissionless controls', () => {
    const src = `${HEAD}
  function setFee() external view returns (uint256) { return feeBps; }
  function setSlippage(uint256 s) external { slippage[msg.sender] = s; }
  // gasguard-permissionless: anyone may re-enable after the timeout
  function setPaused(bool p) external { paused = p; }
  function setOracle(address o) external { oracle = o; }
}`;
    const r = run(src, { permissionlessFunctions: ['setOracle'] });
    expect(r.findings).toEqual([]);
    expect(r.inventory.map((e) => `${e.function}:${e.status}`)).toEqual(['setFee:read-only', 'setPaused:permissionless', 'setOracle:permissionless']);
  });

  it('does not treat deposit-style accumulation of fees as a setter', () => {
    const src = `${HEAD}
  uint256 public accruedFees;
  function deposit(uint256 a) external { accruedFees += a / 100; }
}`;
    expect(kinds(src)).toEqual([]);
  });

  it('ignores invalid options and fails safely on bad input', () => {
    const r = run(`${HEAD}  function setFee(uint256 f) external { feeBps = f; }\n}`, { permissionlessFunctions: ['(bad'] });
    expect(r.diagnostics.some((d) => d.code === 'invalid-option')).toBe(true);
    expect(r.findings).toHaveLength(1);
    for (const bad of ['', 7, 'plain text']) expect(run(bad as string).analyzed).toBe(false);
  });
});
