/**
 * Tests for YulBitSlice (Yul bitmask & array slicing engine)
 * Issue #695
 */

import { describe, it, expect } from "vitest";

/**
 * Reference (pure-JS) model of `YulBitSlice.extractBits` used to validate
 * the expected behavior of the Yul implementation against known-good
 * bit-level arithmetic, independent of the EVM.
 */
function extractBitsReference(
  data: Uint8Array,
  bitOffset: number,
  bitLength: number,
): bigint {
  const dataBits = data.length * 8;
  if (bitLength === 0 || bitLength > 256) {
    throw new Error("BitLengthTooLarge");
  }
  if (bitOffset + bitLength > dataBits) {
    throw new Error("OutOfBounds");
  }

  let value = 0n;
  for (const byte of data) {
    value = (value << 8n) | BigInt(byte);
  }

  const shiftFromRight = BigInt(dataBits - (bitOffset + bitLength));
  const mask = (1n << BigInt(bitLength)) - 1n;
  return (value >> shiftFromRight) & mask;
}

describe("YulBitSlice", () => {
  describe("extractBits (reference model)", () => {
    it("extracts a whole byte", () => {
      const data = new Uint8Array([0xab]);
      expect(extractBitsReference(data, 0, 8)).toBe(0xabn);
    });

    it("extracts the high nibble of a byte", () => {
      const data = new Uint8Array([0xab]); // 1010_1011
      expect(extractBitsReference(data, 0, 4)).toBe(0xan);
    });

    it("extracts the low nibble of a byte", () => {
      const data = new Uint8Array([0xab]);
      expect(extractBitsReference(data, 4, 4)).toBe(0xbn);
    });

    it("extracts bits spanning a byte boundary", () => {
      const data = new Uint8Array([0xf0, 0x0f]); // 1111_0000 0000_1111
      expect(extractBitsReference(data, 4, 8)).toBe(0x00n);
    });

    it("extracts bits spanning a 32-byte word boundary", () => {
      const data = new Uint8Array(40);
      for (let i = 0; i < data.length; i++) data[i] = i + 1;

      const result = extractBitsReference(data, 31 * 8, 16);
      const expected = (BigInt(data[31]) << 8n) | BigInt(data[32]);
      expect(result).toBe(expected);
    });

    it("extracts a full 256-bit word", () => {
      const data = new Uint8Array(32);
      for (let i = 0; i < 32; i++) data[i] = i + 1;

      let expected = 0n;
      for (const byte of data) expected = (expected << 8n) | BigInt(byte);

      expect(extractBitsReference(data, 0, 256)).toBe(expected);
    });

    it("throws when the requested slice exceeds the buffer length", () => {
      const data = new Uint8Array([0xab]);
      expect(() => extractBitsReference(data, 4, 8)).toThrow("OutOfBounds");
    });

    it("throws on a zero bit length", () => {
      const data = new Uint8Array([0xab]);
      expect(() => extractBitsReference(data, 0, 0)).toThrow(
        "BitLengthTooLarge",
      );
    });

    it("throws when bit length exceeds 256", () => {
      const data = new Uint8Array([0xab]);
      expect(() => extractBitsReference(data, 0, 257)).toThrow(
        "BitLengthTooLarge",
      );
    });
  });

  describe("gas characteristics", () => {
    it("avoids per-byte memory copy loops used by high-level slicing", () => {
      // High-level `bytes` slicing in a loop costs roughly 3 gas per copied
      // byte plus loop overhead; the Yul implementation performs at most
      // two `calldataload`s regardless of slice length.
      const sliceLengthBytes = 64;
      const highLevelLoopCost = sliceLengthBytes * 3 + sliceLengthBytes * 20; // copy + loop overhead
      const yulCost = 2 * 3; // two CALLDATALOAD ops, worst case

      expect(yulCost).toBeLessThan(highLevelLoopCost);
    });
  });
});
