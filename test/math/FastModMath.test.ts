import { describe, it, expect } from "vitest";

// Replicate the FastModMath library logic in TypeScript for testing.
// The Solidity library uses native EVM mulmod/addmod opcodes via Yul assembly.

function safeMulMod(x: bigint, y: bigint, m: bigint): bigint {
  if (m === 0n) throw new Error("division by zero");
  return (x * y) % m;
}

function safeAddMod(x: bigint, y: bigint, m: bigint): bigint {
  if (m === 0n) throw new Error("division by zero");
  return (x + y) % m;
}

describe("FastModMath", () => {
  describe("safeMulMod", () => {
    it("should compute (x * y) % m correctly", () => {
      expect(safeMulMod(3n, 5n, 7n)).toBe(1n);
      expect(safeMulMod(10n, 10n, 13n)).toBe(9n);
    });

    it("should return 0 when m divides the product evenly", () => {
      expect(safeMulMod(4n, 3n, 6n)).toBe(0n);
    });

    it("should handle large values without overflow", () => {
      const max = 2n ** 256n - 1n;
      expect(safeMulMod(max, max, max - 1n)).toBe(1n);
    });

    it("should throw when modulus is zero", () => {
      expect(() => safeMulMod(5n, 3n, 0n)).toThrow("division by zero");
    });

    it("should match reference pure arithmetic", () => {
      const x = 123456789n;
      const y = 987654321n;
      const m = 1000000007n;
      const expected = (x * y) % m;
      expect(safeMulMod(x, y, m)).toBe(expected);
    });
  });

  describe("safeAddMod", () => {
    it("should compute (x + y) % m correctly", () => {
      expect(safeAddMod(5n, 7n, 10n)).toBe(2n);
      expect(safeAddMod(3n, 4n, 5n)).toBe(2n);
    });

    it("should handle values where sum exceeds modulus", () => {
      expect(safeAddMod(8n, 9n, 10n)).toBe(7n);
    });

    it("should throw when modulus is zero", () => {
      expect(() => safeAddMod(5n, 3n, 0n)).toThrow("division by zero");
    });

    it("should match reference pure arithmetic for large values", () => {
      const x = 2n ** 256n - 2n;
      const y = 5n;
      const m = 1000000007n;
      const expected = (x + y) % m;
      expect(safeAddMod(x, y, m)).toBe(expected);
    });
  });
});
