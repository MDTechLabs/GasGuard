import { detectUnsafeIntegerDowncasting } from '../../rules/security/math/detect-unsafe-integer-downcasting';

describe('detectUnsafeIntegerDowncasting', () => {
  it('flags uint256 to uint8 downcast', () => {
    const code = `uint8 small = uint8(largeValue);`;
    const result = detectUnsafeIntegerDowncasting(code);
    expect(result.detected).toBe(true);
    expect(result.downcasts.some(d => d.type === 'explicit-narrowing-cast')).toBe(true);
  });

  it('flags solidity uint downcast pattern', () => {
    const code = `uint128(amount);`;
    const result = detectUnsafeIntegerDowncasting(code);
    expect(result.detected).toBe(true);
    expect(result.downcasts.some(d => d.type === 'solidity-downcast')).toBe(true);
  });

  it('flags int256 to int64 downcast', () => {
    const code = `int64(value);`;
    const result = detectUnsafeIntegerDowncasting(code);
    expect(result.detected).toBe(true);
    expect(result.downcasts.some(d => d.type === 'int-downcast')).toBe(true);
  });

  it('returns clean for safe code without downcasting', () => {
    const code = `uint256 total = sum + 1;`;
    const result = detectUnsafeIntegerDowncasting(code);
    expect(result.detected).toBe(false);
  });
});
