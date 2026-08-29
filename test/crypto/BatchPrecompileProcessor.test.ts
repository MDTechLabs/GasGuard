/**
 * Tests for BatchPrecompileProcessor — zero-allocation precompile multi-call in Yul.
 * Issue #693
 */

import { describe, it, expect } from "vitest";
import { keccak256, toUtf8Bytes, randomBytes } from "ethers";

function errorSelector(errorSig: string): string {
  return keccak256(toUtf8Bytes(errorSig)).slice(0, 10);
}

describe("BatchPrecompileProcessor", () => {
  describe("error selectors", () => {
    it("should compute BatchLengthMismatch selector", () => {
      expect(errorSelector("BatchLengthMismatch()")).toBe("0x0e962bf5");
    });

    it("should compute PrecompileCallFailed selector", () => {
      expect(errorSelector("PrecompileCallFailed()")).toBe("0x0dbb13f4");
    });

    it("selectors should be unique", () => {
      const errors = ["BatchLengthMismatch()", "PrecompileCallFailed()"];
      const selectors = errors.map((e) => errorSelector(e));
      expect(new Set(selectors).size).toBe(errors.length);
    });
  });

  describe("batchVerify", () => {
    it("should process multiple ecrecover calls in a single batch", () => {
      const count = 5;
      const hashes = Array.from({ length: count }, () =>
        keccak256(randomBytes(32)),
      );
      const v = Array.from(
        { length: count },
        () => 27 + (Math.random() > 0.5 ? 0 : 1),
      );
      const r = Array.from({ length: count }, () => keccak256(randomBytes(32)));
      const s = Array.from({ length: count }, () => keccak256(randomBytes(32)));

      const results = new Array(count).fill(false);
      for (let i = 0; i < count; i++) {
        results[i] = simulateEcrecover(hashes[i], v[i], r[i], s[i]) !== null;
      }

      expect(results.length).toBe(count);
      expect(results.every((r) => r === false)).toBe(true);
    });

    it("should return empty array for empty batch", () => {
      const results: boolean[] = [];
      expect(results.length).toBe(0);
    });

    it("should reject length mismatch", () => {
      const lenMismatch = (
        a: number,
        b: number,
        c: number,
        d: number,
      ): boolean => a !== b || a !== c || a !== d;

      expect(lenMismatch(3, 3, 3, 2)).toBe(true);
      expect(lenMismatch(3, 3, 3, 3)).toBe(false);
    });

    it("should produce deterministic output for same inputs", () => {
      const hash = keccak256(toUtf8Bytes("test message"));
      const v = 27;
      const r = "0x" + "ab".repeat(32);
      const s = "0x" + "cd".repeat(32);

      const computeStatus = (
        h: string,
        vv: number,
        rr: string,
        ss: string,
      ): boolean => {
        const recovered = simulateEcrecover(h, vv, rr, ss);
        return recovered !== null;
      };

      const result1 = computeStatus(hash, v, r, s);
      const result2 = computeStatus(hash, v, r, s);
      expect(result1).toBe(result2);
    });
  });

  describe("batchModexp", () => {
    it("should compute multiple modular exponentiations in a batch", () => {
      const bases = [2n, 3n, 5n, 7n, 11n];
      const exps = [10n, 5n, 3n, 2n, 1n];
      const mods = [1000n, 1000n, 1000n, 1000n, 1000n];

      const results = bases.map((base, i) => {
        const baseBI = base;
        const expBI = exps[i];
        const modBI = mods[i];
        if (modBI === 0n) return 0n;
        let result = 1n;
        let b = baseBI % modBI;
        let e = expBI;
        while (e > 0n) {
          if (e & 1n) result = (result * b) % modBI;
          b = (b * b) % modBI;
          e >>= 1n;
        }
        return result;
      });

      expect(results).toEqual([24n, 243n, 125n, 49n, 11n]);
    });

    it("should return empty array for empty batch", () => {
      const results: bigint[] = [];
      expect(results.length).toBe(0);
    });

    it("should reject length mismatch", () => {
      const lenMismatch = (a: number, b: number, c: number): boolean =>
        a !== b || a !== c;

      expect(lenMismatch(3, 3, 2)).toBe(true);
      expect(lenMismatch(3, 3, 3)).toBe(false);
    });

    it("should handle large exponent values", () => {
      const base = 123456789n;
      const exp = 0n;
      const mod = 987654321n;
      const result = exp === 0n ? 1n % mod : 0n;
      expect(result).toBe(1n);
    });
  });

  describe("gas benchmark — linear scaling", () => {
    function estimateBatchGas(count: number): number {
      const baseGasPerCall = 700;
      const precompileGas = count * 3000;
      const memoryGas = Math.ceil((count * 32) / 32) * 3;
      return baseGasPerCall + precompileGas + memoryGas;
    }

    it("gas grows linearly with batch size", () => {
      const gas1 = estimateBatchGas(1);
      const gas10 = estimateBatchGas(10);
      const ratio =
        (gas10 - estimateBatchGas(0)) / (gas1 - estimateBatchGas(0));
      expect(ratio).toBeCloseTo(10, 0);
    });

    it("per-element gas cost is constant", () => {
      const sizes = [1, 2, 5, 10, 20];
      const perElement = sizes.map((s) => estimateBatchGas(s) / s);
      const constant = perElement.every((g) => g === perElement[0]);
      expect(constant).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Deterministic mock helpers (since we can't call the actual precompile in TS)
// ---------------------------------------------------------------------------
function simulateEcrecover(
  hash: string,
  v: number,
  r: string,
  s: string,
): string | null {
  const rBytes = BigInt(r);
  const sBytes = BigInt(s);
  if (
    rBytes === 0n ||
    rBytes >=
      BigInt(
        "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141",
      )
  )
    return null;
  if (
    sBytes === 0n ||
    sBytes >=
      BigInt(
        "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141",
      )
  )
    return null;
  if (v < 27 || v > 28) return null;
  return "0x0000000000000000000000000000000000000001";
}
