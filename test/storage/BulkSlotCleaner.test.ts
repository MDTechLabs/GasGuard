import { expect } from "chai";
import { ethers } from "hardhat";
import type { Contract } from "ethers";

describe("BulkSlotCleaner", function () {
  let harness: Contract;

  beforeEach(async function () {
    const Harness = await ethers.getContractFactory("BulkSlotCleanerHarness");
    harness = await Harness.deploy();
    await harness.waitForDeployment();
  });

  it("clears a contiguous storage range without touching adjacent slots", async function () {
    const startSlot = 100n;
    const rangeSize = 3n;
    const guardSlot = startSlot + rangeSize;

    await harness.seedRange(startSlot, rangeSize);
    await harness.seedRange(guardSlot, 1n);

    for (let index = 0n; index < rangeSize; index++) {
      expect(await harness.getValue(startSlot + index)).to.equal(index + 1n);
    }
    expect(await harness.getValue(guardSlot)).to.equal(1n);

    await harness.clearRange(startSlot, rangeSize);

    for (let index = 0n; index < rangeSize; index++) {
      expect(await harness.getValue(startSlot + index)).to.equal(0n);
    }
    expect(await harness.getValue(guardSlot)).to.equal(1n);
  });
});
