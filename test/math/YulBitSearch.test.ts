import { describe, expect, it } from "vitest";

const MAX_UINT256 = (1n << 256n) - 1n;

function mostSignificantBit(value: bigint): bigint {
  if (value === 0n) return 0n;
  let index = 0n;
  let remaining = value;

  for (const [shift, mask] of [
    [128n, (1n << 128n) - 1n],
    [64n, (1n << 64n) - 1n],
    [32n, (1n << 32n) - 1n],
    [16n, (1n << 16n) - 1n],
    [8n, (1n << 8n) - 1n],
    [4n, (1n << 4n) - 1n],
    [2n, 3n],
  ] as const) {
    if (remaining > mask) {
      remaining >>= shift;
      index += shift;
    }
  }

  return index + (remaining > 1n ? 1n : 0n);
}

function leastSignificantBit(value: bigint): bigint {
  if (value === 0n) return 0n;
  let index = 0n;
  let remaining = value;

  for (const [shift, mask] of [
    [128n, (1n << 128n) - 1n],
    [64n, (1n << 64n) - 1n],
    [32n, (1n << 32n) - 1n],
    [16n, (1n << 16n) - 1n],
    [8n, (1n << 8n) - 1n],
    [4n, (1n << 4n) - 1n],
    [2n, 3n],
  ] as const) {
    if ((remaining & mask) === 0n) {
      remaining >>= shift;
      index += shift;
    }
  }

  return index + ((remaining & 1n) === 0n ? 1n : 0n);
}

describe("YulBitSearch", () => {
  it("returns zero for a zero word", () => {
    expect(mostSignificantBit(0n)).toBe(0n);
    expect(leastSignificantBit(0n)).toBe(0n);
  });

  it("finds every singleton bit position", () => {
    for (let index = 0n; index < 256n; index++) {
      const value = 1n << index;
      expect(mostSignificantBit(value)).toBe(index);
      expect(leastSignificantBit(value)).toBe(index);
    }
  });

  it("handles edge and dense values", () => {
    expect(mostSignificantBit(1n)).toBe(0n);
    expect(leastSignificantBit(1n)).toBe(0n);
    expect(mostSignificantBit(1n << 255n)).toBe(255n);
    expect(leastSignificantBit(1n << 255n)).toBe(255n);
    expect(mostSignificantBit(MAX_UINT256)).toBe(255n);
    expect(leastSignificantBit(MAX_UINT256)).toBe(0n);
  });
});
