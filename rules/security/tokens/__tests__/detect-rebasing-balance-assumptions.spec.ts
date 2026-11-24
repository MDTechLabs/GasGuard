import { detectRebasingBalanceAssumptions } from '../detect-rebasing-balance-assumptions';

const run = (src: string, opts?: Parameters<typeof detectRebasingBalanceAssumptions>[1]) => detectRebasingBalanceAssumptions(src, opts);

const STORED = `pragma solidity ^0.8.20;
contract Staking {
  IERC20 public token;
  mapping(address => uint256) public deposits;
  uint256 public totalDeposited;
  function deposit(uint256 amount) external {
    token.safeTransferFrom(msg.sender, address(this), amount);
    deposits[msg.sender] += amount;
    totalDeposited += amount;
  }
  function withdraw(uint256 amount) external {
    require(deposits[msg.sender] >= amount, "bal");
    deposits[msg.sender] -= amount;
    token.safeTransfer(msg.sender, amount);
  }
}`;

describe('detectRebasingBalanceAssumptions', () => {
  it('traces a stored deposit to its later payout and reports both locations', () => {
    const r = run(STORED);
    expect(r.findings).toHaveLength(1);
    const f = r.findings[0];
    expect(f).toMatchObject({ ruleId: 'GG-TOKEN-REBASE-001', kind: 'stale-stored-balance', function: 'deposit', severity: 'medium', confidence: 'medium' });
    expect(f.message).toContain('withdraw()');
    expect(f.details).toMatchObject({ variable: 'deposits', token: 'token' });
    expect(r.tracked.find((t) => t.variable === 'deposits')?.settledIn).toEqual([{ function: 'withdraw', line: 14 }]);
  });

  it('raises severity for a known rebasing token and for arbitrary tokens', () => {
    const steth = STORED.replace(/\btoken\b/g, 'stETH');
    expect(run(steth).findings[0]).toMatchObject({ severity: 'high', confidence: 'high' });
    const arbitrary = `pragma solidity ^0.8.20;
contract Pool {
  mapping(address => mapping(address => uint256)) public deposits;
  function deposit(address token, uint256 amount) external {
    IERC20(token).transferFrom(msg.sender, address(this), amount);
    deposits[token][msg.sender] += amount;
  }
  function withdraw(address token, uint256 amount) external {
    deposits[token][msg.sender] -= amount;
    IERC20(token).transfer(msg.sender, amount);
  }
}`;
    expect(run(arbitrary).findings[0]).toMatchObject({ severity: 'high', confidence: 'medium' });
  });

  it('flags a stored balance snapshot paid out later', () => {
    const src = `pragma solidity ^0.8.20;
contract Escrow {
  IERC20 public asset;
  uint256 public locked;
  function lock() external { locked = asset.balanceOf(address(this)); }
  function release(address to) external { asset.transfer(to, locked); }
}`;
    expect(run(src).findings.map((f) => f.function)).toEqual(['lock']);
  });

  it('accepts share-based accounting', () => {
    const src = `pragma solidity ^0.8.20;
contract Vault {
  IERC20 public token;
  mapping(address => uint256) public sharesOf;
  uint256 public totalShares;
  function deposit(uint256 amount) external {
    uint256 shares = amount * totalShares / token.balanceOf(address(this));
    token.safeTransferFrom(msg.sender, address(this), amount);
    sharesOf[msg.sender] += shares;
    totalShares += shares;
  }
  function withdraw(uint256 shares) external {
    sharesOf[msg.sender] -= shares;
    token.safeTransfer(msg.sender, shares * token.balanceOf(address(this)) / totalShares);
  }
}`;
    const r = run(src);
    expect(r.findings).toEqual([]);
    expect(r.tracked.every((t) => t.status === 'share-based')).toBe(true);
  });

  it('accepts a payout computed from the live balance', () => {
    const src = STORED.replace('token.safeTransfer(msg.sender, amount);', 'token.safeTransfer(msg.sender, amount * token.balanceOf(address(this)) / totalDeposited);');
    expect(run(src).findings).toEqual([]);
  });

  it('honors documented, on-chain and configured rebasing exclusions', () => {
    expect(run(STORED.replace('contract Staking {', 'contract Staking {\n  // Rebasing tokens are not supported.')).findings).toEqual([]);
    expect(run(STORED.replace('token.safeTransferFrom', 'require(!isRebasing(address(token)));\n    token.safeTransferFrom')).findings).toEqual([]);
    const r = run(STORED, { nonRebasingTokens: ['token'] });
    expect(r.findings).toEqual([]);
    expect(r.tracked[0]).toMatchObject({ status: 'excluded', reason: 'nonRebasingTokens option' });
  });

  it('ignores balances that are never paid out and ETH accounting', () => {
    expect(run(STORED.replace('token.safeTransfer(msg.sender, amount);', '')).findings).toEqual([]);
    const eth = `pragma solidity ^0.8.20;
contract Bank { mapping(address => uint256) public bal;
  function deposit() external payable { bal[msg.sender] += msg.value; }
  function withdraw(uint256 a) external { bal[msg.sender] -= a; payable(msg.sender).transfer(a); } }`;
    expect(run(eth).findings).toEqual([]);
  });

  it('rejects invalid options and malformed input safely', () => {
    expect(run(STORED, { nonRebasingTokens: [1] as unknown as string[] }).diagnostics.some((d) => d.code === 'invalid-option')).toBe(true);
    for (const bad of ['', 3, 'hello']) expect(run(bad as string).analyzed).toBe(false);
  });
});
