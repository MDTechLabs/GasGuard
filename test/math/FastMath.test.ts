import { describe, it, expect } from "vitest";

function mul2(x: bigint): bigint {
  return x << 1n;
}

function div4(x: bigint): bigint {
  return x >> 2n;
}

function mod8(x: bigint): bigint {
  return x & 7n;
}

describe("FastMath", () => {
  describe("mul2", () => {
    it("should multiply by 2 using bitwise shift", () => {
      expect(mul2(0n)).toBe(0n);
      expect(mul2(1n)).toBe(2n);
      expect(mul2(21n)).toBe(42n);
      expect(mul2(2n ** 255n)).toBe(2n ** 256n);
    });
  });

  describe("div4", () => {
    it("should divide by 4 using bitwise shift", () => {
      expect(div4(0n)).toBe(0n);
      expect(div4(4n)).toBe(1n);
      expect(div4(17n)).toBe(4n);
      expect(div4(2n ** 256n)).toBe(2n ** 254n);
    });
  });

  describe("mod8", () => {
    it("should compute modulo 8 using bitwise AND", () => {
      expect(mod8(0n)).toBe(0n);
      expect(mod8(7n)).toBe(7n);
      expect(mod8(8n)).toBe(0n);
      expect(mod8(255n)).toBe(7n);
      expect(mod8(2n ** 256n)).toBe(0n);
    });
  });
});
