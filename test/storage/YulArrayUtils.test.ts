import { expect } from "chai";
import { ethers } from "hardhat";
import type { Contract } from "ethers";

describe("YulArrayUtils", function () {
  let harness: Contract;

  beforeEach(async function () {
    const Harness = await ethers.getContractFactory("YulArrayUtilsHarness");
    harness = await Harness.deploy();
    await harness.waitForDeployment();
  });

  describe("uint256[] removal", function () {
    beforeEach(async function () {
      for (const value of [10, 20, 30, 40]) {
        await harness.pushNumber(value);
      }
    });

    it("swaps the last element into the removed index and shrinks the array", async function () {
      await harness.removeNumberAt(1); // remove 20

      const numbers = await harness.getNumbers();
      expect(numbers.map((n: bigint) => Number(n))).to.deep.equal([10, 40, 30]);
      expect(await harness.numbersLength()).to.equal(3);
    });

    it("removing the last element is a plain pop with no swap needed", async function () {
      await harness.removeNumberAt(3); // remove 40 (tail)

      const numbers = await harness.getNumbers();
      expect(numbers.map((n: bigint) => Number(n))).to.deep.equal([10, 20, 30]);
    });

    it("removes down to an empty array", async function () {
      await harness.removeNumberAt(0);
      await harness.removeNumberAt(0);
      await harness.removeNumberAt(0);
      await harness.removeNumberAt(0);

      expect(await harness.numbersLength()).to.equal(0);
    });

    it("reverts on an out-of-bounds index", async function () {
      await expect(harness.removeNumberAt(99)).to.be.revertedWithCustomError(
        harness,
        "IndexOutOfBounds",
      );
    });
  });

  describe("address[] removal", function () {
    it("swaps and pops addresses the same way", async function () {
      const signers = await ethers.getSigners();
      const addrs = signers.slice(0, 3).map((s) => s.address);

      for (const addr of addrs) {
        await harness.pushAddress(addr);
      }

      await harness.removeAddressAt(0);

      const remaining = await harness.getAddresses();
      expect(remaining).to.deep.equal([addrs[2], addrs[1]]);
      expect(await harness.addressesLength()).to.equal(2);
    });
  });

  describe("O(1) cost characteristic", function () {
    it("removal gas cost does not scale with array length", async function () {
      // Use two independent, freshly-deployed harnesses (so every slot
      // starts pristine/zero in both cases) and non-zero values throughout
      // (a stored `0` is a special, cheaper SSTORE case that would bias the
      // comparison). Removing index 0 from a 20-element array should then
      // cost essentially the same as removing index 0 from a 200-element
      // array — unlike Solidity's shifting-based removal, whose cost grows
      // with the number of elements shifted.
      const Harness = await ethers.getContractFactory("YulArrayUtilsHarness");

      const smallHarness = await Harness.deploy();
      await smallHarness.waitForDeployment();
      for (let i = 0; i < 20; i++) {
        await smallHarness.pushNumber(i + 1);
      }
      const txSmall = await (await smallHarness.removeNumberAt(0)).wait();

      const largeHarness = await Harness.deploy();
      await largeHarness.waitForDeployment();
      for (let i = 0; i < 200; i++) {
        await largeHarness.pushNumber(i + 1);
      }
      const txLarge = await (await largeHarness.removeNumberAt(0)).wait();

      const gasSmall = Number(txSmall.gasUsed);
      const gasLarge = Number(txLarge.gasUsed);

      // Allow a small tolerance (e.g. keccak256 base cost is identical, but
      // intrinsic calldata cost can differ by a few gas) — the point is the
      // delta is nowhere near linear in the number of elements shifted
      // (which would add ~180 extra cold SSTOREs for the shift-based
      // approach, i.e. tens of thousands of gas).
      expect(Math.abs(gasLarge - gasSmall)).to.be.lessThan(500);
    });
  });
});
