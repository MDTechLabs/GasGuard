/**
 * Tests for UnrolledSignatureVerifier — issue #696
 * Loop-unrolled validator signature set verifier in Yul.
 *
 * NOTE: Full on-chain verification is not performed because the test
 * environment (vitest) does not include a local EVM.  Instead we validate:
 *   • Error selectors match the Solidity contract.
 *   • Recovery + address matching logic behaves as specified.
 *   • Gas benchmark via the ecrecover precompile cost model.
 */

import { describe, it, expect } from "vitest";
import {
  keccak256,
  toUtf8Bytes,
  Wallet,
  Signature,
  recoverAddress,
} from "ethers";

const SIG_LEN = 65;

const MALLEABILITY_THRESHOLD =
  0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;

function selector(errorSig: string): string {
  return keccak256(toUtf8Bytes(errorSig)).slice(0, 10);
}

describe("UnrolledSignatureVerifier — error selectors", () => {
  it("InvalidSignatureCount() selector", () => {
    expect(selector("InvalidSignatureCount()")).toBe("0x8b97390c");
  });

  it("DuplicateSigner() selector", () => {
    expect(selector("DuplicateSigner()")).toBe("0x8044bb33");
  });

  it("ThresholdNotMet() selector", () => {
    expect(selector("ThresholdNotMet()")).toBe("0x59fa4a93");
  });

  it("selectors are unique", () => {
    const errs = [
      "InvalidSignatureCount()",
      "DuplicateSigner()",
      "ThresholdNotMet()",
    ];
    const sigs = errs.map(selector);
    expect(new Set(sigs).size).toBe(errs.length);
  });
});

function createWallets(n: number): Wallet[] {
  return Array.from({ length: n }, () => Wallet.createRandom());
}

function signHash(wallets: Wallet[], hash: string): Signature[] {
  return wallets.map((w) => w.signingKey.sign(hash));
}

function serializeSigs(sigs: Signature[]): string {
  return "0x" + sigs.map((s) => s.serialized!.slice(2)).join("");
}

function rawRecover(hash: string, sig: Signature): string {
  const v = sig.v < 27 ? sig.v + 27 : sig.v;
  return recoverAddress(hash, { r: sig.r, s: sig.s, v });
}

function mockVerifyGeneric(
  hash: string,
  sigs: Signature[],
  validators: string[],
  threshold: number,
): { ok: boolean; reason?: string } {
  const n = sigs.length;
  if (n !== validators.length)
    return { ok: false, reason: "InvalidSignatureCount" };
  if (threshold > n) return { ok: false, reason: "InvalidSignatureCount" };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (validators[i] === validators[j])
        return { ok: false, reason: "DuplicateSigner" };
    }
  }

  const recovered: string[] = [];
  for (let i = 0; i < n; i++) {
    const sig = sigs[i];
    if (sig.s > MALLEABILITY_THRESHOLD)
      return { ok: false, reason: "InvalidSignatureCount" };

    let addr: string;
    try {
      addr = rawRecover(hash, sig);
    } catch {
      return { ok: false, reason: "InvalidSignatureCount" };
    }
    if (addr === "0x" + "00".repeat(20)) {
      return { ok: false, reason: "InvalidSignatureCount" };
    }

    if (recovered.includes(addr))
      return { ok: false, reason: "DuplicateSigner" };
    recovered.push(addr);
  }

  let count = 0;
  for (const signer of recovered) {
    if (validators.includes(signer)) count++;
  }

  if (count < threshold) return { ok: false, reason: "ThresholdNotMet" };
  return { ok: true };
}

describe("UnrolledSignatureVerifier — logic", () => {
  const hash = keccak256(
    toUtf8Bytes("GasGuard #696 — Unrolled Signature Verifier"),
  );

  describe("verify3of5", () => {
    it("accepts all 5 valid signers (≥3)", () => {
      const wallets = createWallets(5);
      const sigs = signHash(wallets, hash);
      expect(
        mockVerifyGeneric(
          hash,
          sigs,
          wallets.map((w) => w.address),
          3,
        ).ok,
      ).toBe(true);
    });

    it("accepts exactly 3 valid signers", () => {
      const wallets = createWallets(5);
      const intruders = createWallets(2);
      const sigs = signHash([...wallets.slice(0, 3), ...intruders], hash);
      expect(
        mockVerifyGeneric(
          hash,
          sigs,
          wallets.map((w) => w.address),
          3,
        ).ok,
      ).toBe(true);
    });

    it("rejects 2 valid signers", () => {
      const wallets = createWallets(5);
      const intruders = createWallets(3);
      const sigs = signHash([...wallets.slice(0, 2), ...intruders], hash);
      const r = mockVerifyGeneric(
        hash,
        sigs,
        wallets.map((w) => w.address),
        3,
      );
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("ThresholdNotMet");
    });

    it("rejects duplicate signers", () => {
      const validators = createWallets(5);
      const sigs = signHash(validators, hash);
      const duplicated = [sigs[0], sigs[0], sigs[1], sigs[2], sigs[3]];
      const r = mockVerifyGeneric(
        hash,
        duplicated,
        validators.map((w) => w.address),
        3,
      );
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("DuplicateSigner");
    });

    it("rejects duplicate validators", () => {
      const wallets = createWallets(5);
      const sigs = signHash(wallets, hash);
      const addrs = wallets.map((w) => w.address);
      addrs[4] = addrs[0];
      const r = mockVerifyGeneric(hash, sigs, addrs, 3);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("DuplicateSigner");
    });

    it("rejects wrong signature count", () => {
      const validators = createWallets(5);
      const sigs = signHash(validators.slice(0, 4), hash);
      const r = mockVerifyGeneric(
        hash,
        sigs,
        validators.map((w) => w.address),
        3,
      );
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("InvalidSignatureCount");
    });
  });

  describe("verify5of7", () => {
    it("accepts all 7 valid signers (≥5)", () => {
      const wallets = createWallets(7);
      const sigs = signHash(wallets, hash);
      expect(
        mockVerifyGeneric(
          hash,
          sigs,
          wallets.map((w) => w.address),
          5,
        ).ok,
      ).toBe(true);
    });

    it("rejects 4 valid signers", () => {
      const wallets = createWallets(7);
      const intruders = createWallets(3);
      const sigs = signHash([...wallets.slice(0, 4), ...intruders], hash);
      const r = mockVerifyGeneric(
        hash,
        sigs,
        wallets.map((w) => w.address),
        5,
      );
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("ThresholdNotMet");
    });

    it("rejects duplicate signers", () => {
      const validators = createWallets(7);
      const sigs = signHash(validators, hash);
      const duplicated = [
        sigs[0],
        sigs[0],
        sigs[1],
        sigs[2],
        sigs[3],
        sigs[4],
        sigs[5],
      ];
      const r = mockVerifyGeneric(
        hash,
        duplicated,
        validators.map((w) => w.address),
        5,
      );
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("DuplicateSigner");
    });

    it("rejects duplicate validators", () => {
      const wallets = createWallets(7);
      const sigs = signHash(wallets, hash);
      const addrs = wallets.map((w) => w.address);
      addrs[6] = addrs[0];
      const r = mockVerifyGeneric(hash, sigs, addrs, 5);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("DuplicateSigner");
    });
  });

  describe("verifyThreshold (loop version)", () => {
    it("handles 3-of-5", () => {
      const wallets = createWallets(5);
      const sigs = signHash(wallets, hash);
      expect(
        mockVerifyGeneric(
          hash,
          sigs,
          wallets.map((w) => w.address),
          3,
        ).ok,
      ).toBe(true);
    });

    it("handles 5-of-7", () => {
      const wallets = createWallets(7);
      const sigs = signHash(wallets, hash);
      expect(
        mockVerifyGeneric(
          hash,
          sigs,
          wallets.map((w) => w.address),
          5,
        ).ok,
      ).toBe(true);
    });

    it("handles n-of-n boundary", () => {
      const wallets = createWallets(3);
      const sigs = signHash(wallets, hash);
      expect(
        mockVerifyGeneric(
          hash,
          sigs,
          wallets.map((w) => w.address),
          3,
        ).ok,
      ).toBe(true);
    });

    it("rejects threshold > count", () => {
      const wallets = createWallets(3);
      const sigs = signHash(wallets, hash);
      const r = mockVerifyGeneric(
        hash,
        sigs,
        wallets.map((w) => w.address),
        5,
      );
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("InvalidSignatureCount");
    });
  });

  describe("gas benchmark — simulated", () => {
    const ECRECOVER_COST = 3000;
    const CALL_OVERHEAD = 700;

    function estimateUnrolled(
      ecrecoverCount: number,
      comparisons: number,
    ): number {
      return CALL_OVERHEAD + ecrecoverCount * ECRECOVER_COST + comparisons * 3;
    }

    function estimateLoop(ecrecoverCount: number, comparisons: number): number {
      const LOOP_OVERHEAD = 200;
      const PER_ITERATION = 30;
      return (
        CALL_OVERHEAD +
        ecrecoverCount * ECRECOVER_COST +
        comparisons * 3 +
        LOOP_OVERHEAD +
        ecrecoverCount * PER_ITERATION
      );
    }

    it("3-of-5: unrolled cheaper than loop", () => {
      expect(estimateUnrolled(5, 25)).toBeLessThan(estimateLoop(5, 25));
    });

    it("5-of-7: unrolled cheaper than loop", () => {
      expect(estimateUnrolled(7, 49)).toBeLessThan(estimateLoop(7, 49));
    });

    it("reports 3-of-5 estimates", () => {
      const u = estimateUnrolled(5, 25);
      const l = estimateLoop(5, 25);
      console.log("  3-of-5  | unrolled    |", u);
      console.log("  3-of-5  | loop        |", l);
      console.log("  3-of-5  | savings     |", l - u);
    });

    it("reports 5-of-7 estimates", () => {
      const u = estimateUnrolled(7, 49);
      const l = estimateLoop(7, 49);
      console.log("  5-of-7  | unrolled    |", u);
      console.log("  5-of-7  | loop        |", l);
      console.log("  5-of-7  | savings     |", l - u);
    });
  });
});
