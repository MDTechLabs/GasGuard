import { detectFeeOnTransferAssumptions } from '../detect-fee-on-transfer-assumptions';

const wrap = (body: string, extra = '', token = 'token') => `pragma solidity ^0.8.20;
contract Vault {
${extra}
  IERC20 public ${token};
  address public treasury;
  uint256 public totalDeposited;
  mapping(address => uint256) public deposits;
  function deposit(uint256 amount) external {
${body}
  }
}`;
const kinds = (src: string) => detectFeeOnTransferAssumptions(src).findings.map((f) => `${f.kind}:${f.severity}:${f.confidence}`);

const PULL = '    token.safeTransferFrom(msg.sender, address(this), amount);';

describe('detectFeeOnTransferAssumptions', () => {
  it('flags a per-account credit of the requested amount', () => {
    const r = detectFeeOnTransferAssumptions(wrap(`${PULL}\n    deposits[msg.sender] += amount;`));
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ ruleId: 'GG-TOKEN-FEE-001', kind: 'credited-requested-amount', severity: 'high', confidence: 'medium', contract: 'Vault', function: 'deposit' });
    expect(r.findings[0].line).toBeGreaterThan(9);
    expect(r.inflows[0]).toMatchObject({ token: 'token', amount: 'amount', status: 'flagged' });
  });

  it('rates an aggregate counter medium and a mint high', () => {
    expect(kinds(wrap(`${PULL}\n    totalDeposited += amount;`))).toEqual(['credited-requested-amount:medium:medium']);
    expect(kinds(wrap(`${PULL}\n    _mint(msg.sender, amount);`))).toEqual(['credited-requested-amount:high:medium']);
  });

  it('follows the amount through a local alias', () => {
    expect(kinds(wrap(`    uint256 amt = amount;\n    token.safeTransferFrom(msg.sender, address(this), amt);\n    totalDeposited += amount;`))).toEqual(['credited-requested-amount:medium:medium']);
  });

  it('flags forwarding the requested amount at low severity', () => {
    expect(kinds(wrap(`${PULL}\n    token.safeTransfer(treasury, amount);`))).toEqual(['forwarded-requested-amount:low:low']);
  });

  it('accepts the balance-before / balance-after pattern', () => {
    const body = `    uint256 before = token.balanceOf(address(this));
${PULL}
    uint256 received = token.balanceOf(address(this)) - before;
    deposits[msg.sender] += received;`;
    const r = detectFeeOnTransferAssumptions(wrap(body));
    expect(r.findings).toEqual([]);
    expect(r.inflows[0].status).toBe('measured');
  });

  it('accepts contracts that explicitly exclude fee-on-transfer tokens', () => {
    const r = detectFeeOnTransferAssumptions(wrap(`${PULL}\n    deposits[msg.sender] += amount;`, '  // fee-on-transfer tokens are not supported'));
    expect(r.findings).toEqual([]);
    expect(r.inflows[0].status).toBe('excluded');
  });

  it('lowers confidence for well-known fixed tokens and ignores debits', () => {
    expect(kinds(wrap(`    usdc.safeTransferFrom(msg.sender, address(this), amount);\n    totalDeposited += amount;`, '', 'usdc'))).toEqual(['credited-requested-amount:medium:low']);
    expect(kinds(wrap(`${PULL}\n    totalDeposited -= amount;`))).toEqual([]);
  });

  it('produces deterministic findings', () => {
    const src = wrap(`${PULL}\n    deposits[msg.sender] += amount;`);
    expect(detectFeeOnTransferAssumptions(src)).toEqual(detectFeeOnTransferAssumptions(src));
  });

  it('fails safely on malformed or unsupported input', () => {
    for (const bad of [undefined, 3, '', 'hello']) {
      const r = detectFeeOnTransferAssumptions(bad);
      expect(r.analyzed).toBe(false);
      expect(r.findings).toEqual([]);
      expect(r.diagnostics.length).toBeGreaterThan(0);
    }
    expect(() => detectFeeOnTransferAssumptions('contract A { function f() external { token.transferFrom(')).not.toThrow();
  });
});
