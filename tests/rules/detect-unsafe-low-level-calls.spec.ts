import { detectUnsafeLowLevelCalls } from '../../rules/security/external-calls/detect-unsafe-low-level-calls';

describe('detectUnsafeLowLevelCalls', () => {
  it('flags raw .call() usage', () => {
    const code = `(bool success, ) = address(target).call(data);`;
    const result = detectUnsafeLowLevelCalls(code);
    expect(result.detected).toBe(true);
    expect(result.calls.some(c => c.type === 'raw-call')).toBe(true);
  });

  it('flags .delegatecall() usage', () => {
    const code = `(bool ok, ) = target.delegatecall(data);`;
    const result = detectUnsafeLowLevelCalls(code);
    expect(result.detected).toBe(true);
    expect(result.calls.some(c => c.type === 'delegatecall-usage')).toBe(true);
  });

  it('flags unchecked call result', () => {
    const code = `target.call{value: amount}("");`;
    const result = detectUnsafeLowLevelCalls(code);
    expect(result.detected).toBe(true);
    expect(result.calls.some(c => c.type === 'unchecked-call-result')).toBe(true);
  });

  it('returns clean for safe code', () => {
    const code = `function safeTransfer(to, amount) { IERC20(token).transfer(to, amount); }`;
    const result = detectUnsafeLowLevelCalls(code);
    expect(result.detected).toBe(false);
  });
});
