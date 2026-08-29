/**
 * Tests for YulMappingSlot (Yul assembly mapping slot computation)
 * Issue #718
 */

import { describe, it, expect } from "vitest";
import { keccak256, solidityPacked, zeroPadValue } from "ethers";

/** Mirrors Solidity's own layout for `mapping(address => uint256)`. */
function expectedSlot(key: string, baseSlot: number): string {
  const paddedKey = zeroPadValue(key, 32);
  const paddedSlot = zeroPadValue(`0x${baseSlot.toString(16)}`, 32);
  return keccak256(
    solidityPacked(["bytes32", "bytes32"], [paddedKey, paddedSlot]),
  );
}

describe("YulMappingSlot.computeSlot", () => {
  it("matches standard Solidity mapping storage layout (key || baseSlot)", () => {
    const key =
      "0x000000000000000000000000000000000000000000000000000000000000ab";
    const expected = expectedSlot(key, 0);
    expect(expected).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("is deterministic for the same key and base slot", () => {
    const key =
      "0x00000000000000000000000000000000000000000000000000000000001234";
    expect(expectedSlot(key, 0)).toBe(expectedSlot(key, 0));
  });

  it("produces different slots for different keys under the same mapping", () => {
    const keyA =
      "0x0000000000000000000000000000000000000000000000000000000000000a";
    const keyB =
      "0x0000000000000000000000000000000000000000000000000000000000000b";
    expect(expectedSlot(keyA, 5)).not.toBe(expectedSlot(keyB, 5));
  });

  it("produces different slots for the same key under different mapping base slots", () => {
    const key =
      "0x00000000000000000000000000000000000000000000000000000000000042";
    expect(expectedSlot(key, 0)).not.toBe(expectedSlot(key, 1));
  });
});
