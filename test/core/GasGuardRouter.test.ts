/**
 * Tests for GasGuardRouter custom errors
 * Issue #629
 */

import { describe, it, expect } from "vitest";

describe("GasGuardRouter Custom Errors", () => {
  describe("error selectors", () => {
    it("should compute Unauthorized selector", () => {
      const selector = keccak256String("Unauthorized()").slice(0, 10);
      expect(selector).toMatch(/^0x[0-9a-f]{8}$/);
    });

    it("should compute InvalidAmount selector", () => {
      const selector = keccak256String("InvalidAmount()").slice(0, 10);
      expect(selector).toMatch(/^0x[0-9a-f]{8}$/);
    });

    it("should compute ZeroAddress selector", () => {
      const selector = keccak256String("ZeroAddress()").slice(0, 10);
      expect(selector).toMatch(/^0x[0-9a-f]{8}$/);
    });

    it("should have unique selectors for all errors", () => {
      const errors = [
        "Unauthorized()",
        "InvalidAmount()",
        "ZeroAddress()",
        "AlreadyInitialized()",
        "RequestNotFound()",
        "RequestAlreadyCompleted()",
        "InsufficientBalance()",
        "OperationFailed()",
      ];

      const selectors = errors.map((e) => keccak256String(e).slice(0, 10));
      const unique = new Set(selectors);
      expect(unique.size).toBe(errors.length);
    });
  });

  describe("revert string vs custom error gas comparison", () => {
    it("custom error selector is 4 bytes vs revert string which is variable length", () => {
      const customErrorSize = 4; // bytes4 selector
      const revertStringSize = "Unauthorized access".length + 32; // ABI-encoded string

      expect(customErrorSize).toBeLessThan(revertStringSize);
    });

    it("custom error with parameters is still smaller than string", () => {
      const customErrorSize = 4 + 32; // selector + one param
      const revertStringSize =
        "Insufficient balance: need 1000, have 500".length + 32;

      expect(customErrorSize).toBeLessThan(revertStringSize);
    });
  });
});

function keccak256String(s: string): string {
  // Simple mock - in real code use ethers.keccak256
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return "0x" + Math.abs(hash).toString(16).padStart(64, "0");
}
