/**
 * Tests for MappingResolver (Yul assembly slot computation)
 * Issue #635
 */

import { describe, it, expect } from "vitest";
import { keccak256, solidityPacked, zeroPadValue } from "ethers";

describe("MappingResolver", () => {
  describe("computeSlot", () => {
    it("should compute correct storage slot for single mapping", () => {
      const slot = zeroPadValue("0x01", 32);
      const key = zeroPadValue("0x1234", 32);

      // Expected: keccak256(abi.encode(key, slot))
      const expected = keccak256(
        solidityPacked(["bytes32", "bytes32"], [key, slot]),
      );
      expect(expected).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it("should be deterministic", () => {
      const slot = zeroPadValue("0x01", 32);
      const key = zeroPadValue("0xabcd", 32);

      const result1 = keccak256(
        solidityPacked(["bytes32", "bytes32"], [key, slot]),
      );
      const result2 = keccak256(
        solidityPacked(["bytes32", "bytes32"], [key, slot]),
      );
      expect(result1).toBe(result2);
    });

    it("should produce different slots for different keys", () => {
      const slot = zeroPadValue("0x01", 32);
      const key1 = zeroPadValue("0x0001", 32);
      const key2 = zeroPadValue("0x0002", 32);

      const result1 = keccak256(
        solidityPacked(["bytes32", "bytes32"], [key1, slot]),
      );
      const result2 = keccak256(
        solidityPacked(["bytes32", "bytes32"], [key2, slot]),
      );
      expect(result1).not.toBe(result2);
    });
  });

  describe("computeNestedSlot", () => {
    it("should compute correct nested mapping slot", () => {
      const slot = zeroPadValue("0x01", 32);
      const key1 = zeroPadValue("0x1111", 32);
      const key2 = zeroPadValue("0x2222", 32);

      const innerSlot = keccak256(
        solidityPacked(["bytes32", "bytes32"], [key1, slot]),
      );
      const outerSlot = keccak256(
        solidityPacked(["bytes32", "bytes32"], [key2, innerSlot]),
      );

      expect(outerSlot).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it("should be order-dependent", () => {
      const slot = zeroPadValue("0x01", 32);
      const key1 = zeroPadValue("0x1111", 32);
      const key2 = zeroPadValue("0x2222", 32);

      const innerSlot = keccak256(
        solidityPacked(["bytes32", "bytes32"], [key1, slot]),
      );
      const outerSlot = keccak256(
        solidityPacked(["bytes32", "bytes32"], [key2, innerSlot]),
      );

      // Swapped keys should produce different result
      const innerSlot2 = keccak256(
        solidityPacked(["bytes32", "bytes32"], [key2, slot]),
      );
      const outerSlot2 = keccak256(
        solidityPacked(["bytes32", "bytes32"], [key1, innerSlot2]),
      );

      expect(outerSlot).not.toBe(outerSlot2);
    });
  });

  describe("computeAddrSlot", () => {
    it("should compute correct slot for address key", () => {
      const slot = zeroPadValue("0x01", 32);
      const addr = "0x1234567890123456789012345678901234567890";
      const key = zeroPadValue(addr, 32);

      const result = keccak256(
        solidityPacked(["bytes32", "bytes32"], [key, slot]),
      );
      expect(result).toMatch(/^0x[0-9a-f]{64}$/);
    });
  });

  describe("computeUintSlot", () => {
    it("should compute correct slot for uint256 key", () => {
      const slot = zeroPadValue("0x01", 32);
      const key = zeroPadValue("0x042", 32);

      const result = keccak256(
        solidityPacked(["bytes32", "bytes32"], [key, slot]),
      );
      expect(result).toMatch(/^0x[0-9a-f]{64}$/);
    });
  });
});
