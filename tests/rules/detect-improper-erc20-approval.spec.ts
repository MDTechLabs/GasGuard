import { detectImproperERC20Approval } from '../../rules/security/tokens/detect-improper-erc20-approval';

describe('detectImproperERC20Approval', () => {
  it('flags direct approve() calls', () => {
    const code = `token.approve(spender, amount);`;
    const result = detectImproperERC20Approval(code);
    expect(result.detected).toBe(true);
    expect(result.approvals.some(a => a.type === 'direct-approve-overwrite')).toBe(true);
  });

  it('flags unchecked approve return values', () => {
    const code = `erc20.approve(address(this), 1000);`;
    const result = detectImproperERC20Approval(code);
    expect(result.detected).toBe(true);
  });

  it('returns clean for no approval usage', () => {
    const code = `function transfer(to, amount) { balance -= amount; }`;
    const result = detectImproperERC20Approval(code);
    expect(result.detected).toBe(false);
  });
});
