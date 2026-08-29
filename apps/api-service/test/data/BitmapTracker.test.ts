import { expect } from "chai";
import { network } from "hardhat";

describe("BitmapTracker", () => {
  async function deployFixture() {
    const { ethers } = await network.create();
    const tracker = await (await ethers.getContractFactory("BitmapTracker")).deploy();
    const naive = await (await ethers.getContractFactory("NaiveBoolMapping")).deploy();
    return { ethers, tracker, naive };
  }

  describe("generic set/isSet round trip", () => {
    it("defaults every index to false before it is set", async () => {
      const { tracker } = await deployFixture();
      for (const index of [0, 1, 255, 256, 1000, 123456]) {
        expect(await tracker.isSet(index)).to.equal(false);
      }
    });

    it("round-trips a single bit correctly", async () => {
      const { tracker } = await deployFixture();
      await (await tracker.set(42)).wait();
      expect(await tracker.isSet(42)).to.equal(true);
      expect(await tracker.isSet(41)).to.equal(false);
      expect(await tracker.isSet(43)).to.equal(false);
    });

    it("round-trips adjacent bits within the same 256-bit slot", async () => {
      const { tracker } = await deployFixture();
      // 10, 11, 12 all live in bucket 0 (index / 256 == 0).
      await (await tracker.set(10)).wait();
      await (await tracker.set(12)).wait();

      expect(await tracker.isSet(10)).to.equal(true);
      expect(await tracker.isSet(11)).to.equal(false);
      expect(await tracker.isSet(12)).to.equal(true);
    });

    it("round-trips bits across different slots (bucket boundaries)", async () => {
      const { tracker } = await deployFixture();
      // 255 is the last bit of bucket 0; 256 is the first bit of bucket 1.
      await (await tracker.set(255)).wait();
      await (await tracker.set(256)).wait();
      await (await tracker.set(512)).wait();
      await (await tracker.set(1000)).wait();

      expect(await tracker.isSet(255)).to.equal(true);
      expect(await tracker.isSet(256)).to.equal(true);
      expect(await tracker.isSet(257)).to.equal(false);
      expect(await tracker.isSet(511)).to.equal(false);
      expect(await tracker.isSet(512)).to.equal(true);
      expect(await tracker.isSet(1000)).to.equal(true);
    });

    it("round-trips a large sweep of indices across many buckets without cross-talk", async () => {
      const { tracker } = await deployFixture();
      const setIndices = new Set<number>();
      for (let i = 0; i < 50; i++) {
        // Spread indices across ~50 different buckets, at varying bit offsets.
        const index = i * 257 + i;
        setIndices.add(index);
        await (await tracker.set(index)).wait();
      }

      for (let i = 0; i < 50; i++) {
        const index = i * 257 + i;
        expect(await tracker.isSet(index), `index ${index} should be set`).to.equal(true);
      }

      // Spot-check a handful of neighboring indices that were never set.
      for (const probe of [1, 2, 300, 301, 5000, 5001, 12345]) {
        if (!setIndices.has(probe)) {
          expect(await tracker.isSet(probe), `index ${probe} should not be set`).to.equal(false);
        }
      }
    });

    it("clears a bit with unset() without touching its neighbors", async () => {
      const { tracker } = await deployFixture();
      await (await tracker.set(100)).wait();
      await (await tracker.set(101)).wait();
      await (await tracker.set(102)).wait();

      await (await tracker.unset(101)).wait();

      expect(await tracker.isSet(100)).to.equal(true);
      expect(await tracker.isSet(101)).to.equal(false);
      expect(await tracker.isSet(102)).to.equal(true);
    });

    it("handles very large indices (far beyond a small bucket count)", async () => {
      const { tracker } = await deployFixture();
      const bigIndex = 2n ** 200n + 12345n;
      await (await tracker.set(bigIndex)).wait();
      expect(await tracker.isSet(bigIndex)).to.equal(true);
      expect(await tracker.isSet(bigIndex + 1n)).to.equal(false);
    });
  });

  describe("named namespaces stay isolated from each other and from the generic bitmap", () => {
    it("operational flags, nonces and claims do not collide on the same index", async () => {
      const { tracker } = await deployFixture();
      const index = 7;

      await (await tracker.setOperationalFlag(index)).wait();

      expect(await tracker.isOperationalFlagSet(index)).to.equal(true);
      expect(await tracker.isNonceProcessed(index)).to.equal(false);
      expect(await tracker.isClaimed(index)).to.equal(false);
      expect(await tracker.isSet(index)).to.equal(false);
    });

    it("marks a nonce as processed and rejects reprocessing", async () => {
      const { tracker } = await deployFixture();
      await (await tracker.markNonceProcessed(99)).wait();
      expect(await tracker.isNonceProcessed(99)).to.equal(true);

      await expect(tracker.markNonceProcessed(99)).to.be.revertedWith(
        "BitmapTracker: nonce already processed",
      );
    });

    it("records a claim and rejects double-claiming", async () => {
      const { tracker } = await deployFixture();
      await (await tracker.recordClaim(4242)).wait();
      expect(await tracker.isClaimed(4242)).to.equal(true);

      await expect(tracker.recordClaim(4242)).to.be.revertedWith("BitmapTracker: already claimed");
    });
  });

  describe("gas cost vs. a naive mapping(uint256 => bool)", () => {
    it("setting a second bit in an already-warm bucket is meaningfully cheaper than a fresh mapping slot", async () => {
      const { tracker, naive } = await deployFixture();

      // Warm up bucket 0 of the bitmap by setting its first bit. This is the
      // "pay for a fresh slot" transaction for the bitmap, analogous to the
      // naive mapping's very first write.
      const warmUpReceipt = await (await tracker.set(0)).wait();

      // Setting a second, distinct bit in the *same* bucket only flips a bit
      // inside an already-nonzero, already-warm storage slot.
      const secondBitReceipt = await (await tracker.set(1)).wait();

      // The naive mapping's equivalent write always touches a brand-new
      // storage slot (zero -> nonzero, cold), which is the expensive case
      // the bitmap pattern is designed to avoid for every flag after the
      // first one in a given 256-slot bucket.
      const naiveReceipt = await (await naive.set(1)).wait();

      const warmUpGas = warmUpReceipt!.gasUsed;
      const secondBitGas = secondBitReceipt!.gasUsed;
      const naiveGas = naiveReceipt!.gasUsed;

      // Sanity: setting a bit in a slot that's already dirty this same
      // "session" should never cost more than establishing that slot did.
      expect(secondBitGas).to.be.lessThan(warmUpGas);

      // The core claim from the issue: reusing an already-set bucket is
      // meaningfully cheaper than paying for a fresh mapping slot. Both
      // numbers include the same ~21,000 gas of fixed transaction overhead
      // (intrinsic cost, calldata, dispatch), which dilutes a *relative*
      // comparison — so we assert on the absolute gas margin instead. A
      // fresh SSTORE (zero -> nonzero) costs 20,000 gas versus ~5,000 gas
      // for a cold-then-warm SLOAD+SSTORE on an already-nonzero slot, so we
      // expect at least ~10,000 gas of savings; that's a conservative
      // threshold that avoids being brittle to unrelated opcode overhead.
      expect(secondBitGas).to.be.lessThan(naiveGas);
      expect(naiveGas - secondBitGas).to.be.greaterThan(10_000n);
    });
  });
});
