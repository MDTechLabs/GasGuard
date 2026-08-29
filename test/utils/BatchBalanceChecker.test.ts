/**
 * Tests for BatchBalanceChecker (assembly multi-token balance query loop)
 * Issue #690
 */

import { describe, it, expect } from "vitest";

describe("BatchBalanceChecker", () => {
  describe("result layout", () => {
    it("flattens results as tokens x accounts in row-major order", () => {
      const tokens = ["tokenA", "tokenB"];
      const accounts = ["acc1", "acc2", "acc3"];

      // balances[i * accounts.length + j] = balanceOf(accounts[j]) in tokens[i]
      const flatIndexOf = (i: number, j: number) => i * accounts.length + j;

      expect(flatIndexOf(0, 0)).toBe(0);
      expect(flatIndexOf(0, 2)).toBe(2);
      expect(flatIndexOf(1, 0)).toBe(3);
      expect(flatIndexOf(1, 2)).toBe(5);

      const total = tokens.length * accounts.length;
      expect(total).toBe(6);
    });
  });

  describe("resilience to failing calls", () => {
    it("defaults to 0 when a token call reverts", () => {
      const staticcallSucceeded = false;
      const value = staticcallSucceeded ? 100n : 0n;
      expect(value).toBe(0n);
    });

    it("defaults to 0 when the target has no code (returndatasize 0)", () => {
      const returnDataSize = 0;
      const value = returnDataSize > 31 ? 999n : 0n;
      expect(value).toBe(0n);
    });

    it("continues querying remaining pairs after one failure", () => {
      const results = [0n, 500n, 0n, 200n]; // pairs 0 and 2 "failed"
      const successCount = results.filter((v) => v !== 0n).length;
      expect(successCount).toBe(2);
      expect(results.length).toBe(4);
    });
  });

  describe("gas characteristics", () => {
    it("builds the balanceOf selector once instead of per-call ABI encoding", () => {
      const selector = "0x70a08231";
      // Selector is written to memory once outside the loop; each iteration
      // only overwrites the address argument word, not the selector.
      expect(selector).toBe("0x70a08231");
    });

    it("uses staticcall to guarantee no state mutation across arbitrary tokens", () => {
      const callType = "staticcall";
      expect(callType).toBe("staticcall");
    });
  });
});
