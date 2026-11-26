import { detectUnsafeBalanceDelta } from '../detect-unsafe-balance-delta';

const wrap = (body: string, pragma = '^0.8.20') => `pragma solidity ${pragma};
contract Pool {
  IERC20 public token;
  IERC20 public other;
  function deposit(uint256 amount, address recipient) external {
${body}
  }
}`;
const kinds = (src: string) => detectUnsafeBalanceDelta(src).findings.map((f) => `${f.kind}:${f.severity}`);

const IN = `    uint256 before = token.balanceOf(address(this));
    token.safeTransferFrom(msg.sender, address(this), amount);`;

describe('detectUnsafeBalanceDelta', () => {
  it('accepts the correct inflow and outflow deltas', () => {
    const inflow = wrap(`${IN}\n    uint256 received = token.balanceOf(address(this)) - before;`);
    const r = detectUnsafeBalanceDelta(inflow);
    expect(r.findings).toEqual([]);
    expect(r.deltas[0]).toMatchObject({ form: 'after-before', direction: 'inflow', status: 'ok', token: 'token', account: 'this' });
    const outflow = wrap(`    uint256 before = token.balanceOf(address(this));
    token.safeTransfer(recipient, amount);
    uint256 sent = before - token.balanceOf(address(this));`);
    expect(detectUnsafeBalanceDelta(outflow).findings).toEqual([]);
  });

  it('accepts a measured fee collection and a transfer whose token may invoke a callback', () => {
    const fee = wrap(`    uint256 feeBefore = token.balanceOf(recipient);
    token.safeTransferFrom(address(this), recipient, amount);
    uint256 feeCollected = token.balanceOf(recipient) - feeBefore;`);
    expect(detectUnsafeBalanceDelta(fee).findings).toEqual([]);

    const callback = wrap(`    uint256 before = token.balanceOf(address(this));
    token.safeTransferFrom(msg.sender, address(this), amount); // token callbacks may run before this returns
    uint256 received = token.balanceOf(address(this)) - before;`);
    expect(detectUnsafeBalanceDelta(callback).findings).toEqual([]);
  });

  it('flags a reversed inflow delta, with higher severity when arithmetic is unchecked', () => {
    const reversed = wrap(`${IN}\n    uint256 received = before - token.balanceOf(address(this));`);
    const [f] = detectUnsafeBalanceDelta(reversed).findings;
    expect(f).toMatchObject({ kind: 'reversed-delta', severity: 'medium', confidence: 'high', function: 'deposit' });
    expect(f.message).toContain('inflow');
    expect(kinds(reversed.replace('^0.8.20', '^0.7.6'))).toEqual(['reversed-delta:high']);
    const unchecked = wrap(`${IN}\n    uint256 received;\n    unchecked { received = before - token.balanceOf(address(this)); }`);
    expect(kinds(unchecked)).toEqual(['reversed-delta:high']);
  });

  it('flags a reversed outflow delta', () => {
    const src = wrap(`    uint256 before = token.balanceOf(address(this));
    token.safeTransfer(recipient, amount);
    uint256 sent = token.balanceOf(address(this)) - before;`);
    expect(kinds(src)).toEqual(['reversed-delta:medium']);
  });

  it('uses the result name when no transfer is visible, at low confidence', () => {
    const src = wrap(`    uint256 before = token.balanceOf(address(this));
    _pull(amount);
    uint256 received = before - token.balanceOf(address(this));`);
    const [f] = detectUnsafeBalanceDelta(src).findings;
    expect(f).toMatchObject({ kind: 'reversed-delta', confidence: 'low' });
  });

  it('flags reads of a different account or token', () => {
    const account = wrap(`${IN}\n    uint256 received = token.balanceOf(msg.sender) - before;`);
    const [a] = detectUnsafeBalanceDelta(account).findings;
    expect(a).toMatchObject({ kind: 'mismatched-balance-reads', severity: 'high' });
    expect(a.message).toContain('accounts this vs msg.sender');
    const tokenMix = wrap(`${IN}\n    uint256 received = other.balanceOf(address(this)) - before;`);
    expect(detectUnsafeBalanceDelta(tokenMix).findings[0].message).toContain('tokens other vs token');
  });

  it('flags a measured account the transfer does not touch, and mixed flows', () => {
    const untouched = wrap(`    uint256 before = token.balanceOf(address(this));
    token.safeTransferFrom(msg.sender, recipient, amount);
    uint256 received = token.balanceOf(address(this)) - before;`);
    expect(kinds(untouched)).toEqual(['unrelated-balance-change:medium']);
    const mixed = wrap(`${IN}
    token.safeTransferFrom(msg.sender, address(this), amount);
    uint256 received = token.balanceOf(address(this)) - before;`);
    expect(kinds(mixed)).toEqual(['unrelated-balance-change:medium']);
  });

  it('flags before/after variables read in the opposite order', () => {
    const src = wrap(`    uint256 balanceAfter = token.balanceOf(address(this));
    token.safeTransferFrom(msg.sender, address(this), amount);
    uint256 balanceBefore = token.balanceOf(address(this));
    uint256 received = balanceBefore - balanceAfter;`);
    expect(kinds(src)).toEqual(['swapped-balance-reads:low']);
  });

  it('reports an unguarded unchecked delta but accepts a guarded one', () => {
    const unchecked = wrap(`${IN}\n    uint256 received;\n    unchecked { received = token.balanceOf(address(this)) - before; }`);
    expect(kinds(unchecked)).toEqual(['unchecked-balance-delta:low']);
    const guarded = wrap(`${IN}\n    uint256 after_ = token.balanceOf(address(this));\n    require(after_ >= before);\n    uint256 received;\n    unchecked { received = after_ - before; }`);
    expect(kinds(guarded)).toEqual([]);
    const wrongGuard = wrap(`${IN}\n    uint256 after_ = token.balanceOf(address(this));\n    require(before >= after_);\n    uint256 received;\n    unchecked { received = after_ - before; }`);
    expect(kinds(wrongGuard)).toContain('unchecked-balance-delta:low');
  });

  it('accepts intentional signed deltas and two-sided handling', () => {
    const signed = wrap(`${IN}\n    int256 delta = int256(before) - int256(token.balanceOf(address(this)));`);
    expect(detectUnsafeBalanceDelta(signed).findings).toEqual([]);
    expect(detectUnsafeBalanceDelta(signed).deltas[0].status).toBe('intentional');
    const branch = wrap(`${IN}\n    uint256 after_ = token.balanceOf(address(this));\n    uint256 diff = after_ > before ? after_ - before : before - after_;`);
    expect(detectUnsafeBalanceDelta(branch).findings).toEqual([]);
    const oneSided = wrap(`${IN}\n    uint256 after_ = token.balanceOf(address(this));\n    uint256 received = before > after_ ? before - after_ : before - after_;`);
    expect(kinds(oneSided)).toContain('reversed-delta:medium');
  });

  it('fails safely on malformed input', () => {
    for (const bad of ['', 9, 'plain text']) expect(detectUnsafeBalanceDelta(bad as string).analyzed).toBe(false);
  });
});
