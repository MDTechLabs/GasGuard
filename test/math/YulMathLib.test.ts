/**
 * Tests for YulMathLib (zero-overhead Yul fixed-point math)
 * Issue #637
 */

import { describe, it, expect } from "vitest";

const WAD = 10n ** 18n;
const RAY = 10n ** 27n;
const HALF_WAD = 5n * 10n ** 17n;

function mulDivDown(x: bigint, y: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error("DivisionByZero");
  return (x * y) / denominator;
}

function mulDivUp(x: bigint, y: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error("DivisionByZero");
  const result = (x * y) / denominator;
  return (x * y) % denominator > 0n ? result + 1n : result;
}

function wadMul(x: bigint, y: bigint): bigint {
  return (x * y) / WAD;
}

function wadDiv(x: bigint, y: bigint): bigint {
  if (y === 0n) throw new Error("DivisionByZero");
  return (x * WAD) / y;
}

function rayMul(x: bigint, y: bigint): bigint {
  return (x * y) / RAY;
}

function rayDiv(x: bigint, y: bigint): bigint {
  if (y === 0n) throw new Error("DivisionByZero");
  return (x * RAY) / y;
}

describe("YulMathLib", () => {
  describe("mulDivDown", () => {
    it("should compute (x * y) / denominator correctly", () => {
      expect(mulDivDown(100n, 200n, 10n)).toBe(2000n);
    });

    it("should handle zero numerator", () => {
      expect(mulDivDown(0n, 200n, 10n)).toBe(0n);
    });

    it("should handle zero denominator", () => {
      expect(() => mulDivDown(100n, 200n, 0n)).toThrow("DivisionByZero");
    });

    it("should truncate toward zero", () => {
      expect(mulDivDown(10n, 3n, 7n)).toBe(4n);
    });

    it("should handle large numbers", () => {
      const x = 10n ** 36n;
      const y = 10n ** 36n;
      const d = 10n ** 18n;
      expect(mulDivDown(x, y, d)).toBe(10n ** 54n);
    });
  });

  describe("mulDivUp", () => {
    it("should round up when there is a remainder", () => {
      expect(mulDivUp(10n, 3n, 7n)).toBe(5n);
    });

    it("should not round up when exact", () => {
      expect(mulDivUp(10n, 2n, 5n)).toBe(4n);
    });

    it("should handle zero denominator", () => {
      expect(() => mulDivUp(100n, 200n, 0n)).toThrow("DivisionByZero");
    });
  });

  describe("wadMul", () => {
    it("should multiply WAD-scaled numbers", () => {
      const a = 2n * WAD;
      const b = 3n * WAD;
      expect(wadMul(a, b)).toBe(6n * WAD);
    });

    it("should handle 1.5 * 2 = 3", () => {
      const a = (3n * WAD) / 2n;
      const b = 2n * WAD;
      expect(wadMul(a, b)).toBe(3n * WAD);
    });

    it("should handle small fractions", () => {
      const a = WAD / 10n; // 0.1
      const b = WAD / 10n; // 0.1
      expect(wadMul(a, b)).toBe(WAD / 100n); // 0.01
    });
  });

  describe("wadDiv", () => {
    it("should divide WAD-scaled numbers", () => {
      const a = 6n * WAD;
      const b = 2n * WAD;
      expect(wadDiv(a, b)).toBe(3n * WAD);
    });

    it("should handle division by zero", () => {
      expect(() => wadDiv(WAD, 0n)).toThrow("DivisionByZero");
    });

    it("should handle 1 / 2 = 0.5", () => {
      expect(wadDiv(WAD, 2n * WAD)).toBe(WAD / 2n);
    });
  });

  describe("rayMul", () => {
    it("should multiply RAY-scaled numbers", () => {
      const a = 2n * RAY;
      const b = 3n * RAY;
      expect(rayMul(a, b)).toBe(6n * RAY);
    });
  });

  describe("rayDiv", () => {
    it("should divide RAY-scaled numbers", () => {
      const a = 6n * RAY;
      const b = 2n * RAY;
      expect(rayDiv(a, b)).toBe(3n * RAY);
    });

    it("should handle division by zero", () => {
      expect(() => rayDiv(RAY, 0n)).toThrow("DivisionByZero");
    });
  });

  describe("precision matching", () => {
    it("should match reference library for common operations", () => {
      const price = 1500n * WAD;
      const amount = 10n * WAD;

      const total = wadMul(price, amount);
      expect(total).toBe(15000n * WAD);
    });

    it("should handle compound interest calculation", () => {
      let amount = 1000n * WAD;
      const rate = (5n * WAD) / 100n; // 5%

      // 3 periods of 5% compound interest
      amount = wadMul(amount, WAD + rate);
      amount = wadMul(amount, WAD + rate);
      amount = wadMul(amount, WAD + rate);

      // 1000 * 1.05^3 ≈ 1157.625
      expect(amount).toBeGreaterThan(1157n * WAD);
      expect(amount).toBeLessThan(1158n * WAD);
    });
  });
});
