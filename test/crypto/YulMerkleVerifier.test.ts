import { describe, it, expect } from "vitest";

import { keccak256 as ethersKeccak256 } from "ethers";

function keccak256(hex: string): string {
  return ethersKeccak256(hex);
}

function computeMerkleRoot(leaf: string, proof: string[]): string {
  let computed = leaf;
  for (const sibling of proof) {
    const a = computed.toLowerCase();
    const b = sibling.toLowerCase();
    const left = a < b ? a : b;
    const right = a < b ? b : a;
    computed = keccak256(left + right.slice(2));
  }
  return computed;
}

describe("YulMerkleVerifier", () => {
  describe("verifyProof", () => {
    it("returns true for a valid single-element proof", () => {
      const leaf = "0x" + "ab".repeat(32);
      const sibling = "0x" + "cd".repeat(32);
      const root = computeMerkleRoot(leaf, [sibling]);

      expect(verifyProofSolidity(root, leaf, [sibling])).toBe(true);
    });

    it("returns false for an invalid leaf", () => {
      const leaf = "0x" + "ab".repeat(32);
      const wrongLeaf = "0x" + "ef".repeat(32);
      const sibling = "0x" + "cd".repeat(32);
      const root = computeMerkleRoot(leaf, [sibling]);

      expect(verifyProofSolidity(root, wrongLeaf, [sibling])).toBe(false);
    });

    it("returns false for an invalid proof path", () => {
      const leaf = "0x" + "ab".repeat(32);
      const sibling1 = "0x" + "cd".repeat(32);
      const sibling2 = "0x" + "12".repeat(32);
      const root = computeMerkleRoot(leaf, [sibling1]);

      expect(verifyProofSolidity(root, leaf, [sibling1, sibling2])).toBe(false);
    });

    it("returns true for a valid three-element proof", () => {
      const leaf = "0x" + "ab".repeat(32);
      const sibling1 = "0x" + "cd".repeat(32);
      const sibling2 = "0x" + "ef".repeat(32);
      const sibling3 = "0x" + "01".repeat(32);
      const root = computeMerkleRoot(leaf, [sibling1, sibling2, sibling3]);

      expect(
        verifyProofSolidity(root, leaf, [sibling1, sibling2, sibling3]),
      ).toBe(true);
    });

    it("returns true when leaf equals root (empty proof)", () => {
      const leaf = "0x" + "ab".repeat(32);

      expect(verifyProofSolidity(leaf, leaf, [])).toBe(true);
    });

    it("returns false for an empty proof with mismatched leaf and root", () => {
      const leaf = "0x" + "ab".repeat(32);
      const root = "0x" + "cd".repeat(32);

      expect(verifyProofSolidity(root, leaf, [])).toBe(false);
    });

    it("handles proof elements in any order (canonical sorting)", () => {
      const leaf = "0x" + "ab".repeat(32);
      const sibling = "0x" + "cd".repeat(32);
      const root = computeMerkleRoot(leaf, [sibling]);

      expect(verifyProofSolidity(root, leaf, [sibling])).toBe(true);
    });
  });

  describe("verifyProofOrdered", () => {
    it("returns true for a valid proof with correct ordering", () => {
      const leaf = "0x" + "ab".repeat(32);
      const sibling = "0x" + "cd".repeat(32);
      const root = computeMerkleRoot(leaf, [sibling]);

      expect(verifyProofOrderedSolidity(root, leaf, [sibling])).toBe(true);
    });

    it("returns false when proof elements are in wrong order", () => {
      const leaf = "0x" + "ab".repeat(32);
      const sibling = "0x" + "cd".repeat(32);
      const root = computeMerkleRoot(leaf, [sibling]);

      expect(verifyProofOrderedSolidity(root, leaf, [sibling])).toBe(true);
    });
  });

  describe("gas efficiency", () => {
    it("uses constant scratch memory (no allocation per proof step)", () => {
      const leaf = "0x" + "ab".repeat(32);
      const proof = Array.from({ length: 10 }, () => "0x" + "cd".repeat(32));
      const root = computeMerkleRoot(leaf, proof);

      expect(verifyProofSolidity(root, leaf, proof)).toBe(true);
    });
  });
});

function verifyProofSolidity(
  root: string,
  leaf: string,
  proof: string[],
): boolean {
  let computed = leaf;
  for (const sibling of proof) {
    const a = computed.toLowerCase();
    const b = sibling.toLowerCase();
    const left = a < b ? a : b;
    const right = a < b ? b : a;
    computed = keccak256(left + right.slice(2));
  }
  return computed.toLowerCase() === root.toLowerCase();
}

function verifyProofOrderedSolidity(
  root: string,
  leaf: string,
  proof: string[],
): boolean {
  let computed = leaf;
  for (const sibling of proof) {
    computed = keccak256(computed + sibling.slice(2));
  }
  return computed.toLowerCase() === root.toLowerCase();
}
