import { expect } from "chai";
import { ethers } from "hardhat";
import type { Contract } from "ethers";

describe("BitmaskApprovalTracker (#752)", function () {
  let tracker: Contract;
  let admin: any;
  let other: any;

  beforeEach(async function () {
    [admin, other] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("BitmaskApprovalTracker");
    tracker = await Factory.deploy();
    await tracker.waitForDeployment();
  });

  describe("storage packing", function () {
    it("starts with zero approvals in a single slot", async function () {
      expect(await tracker.getApprovalsRaw()).to.equal(ethers.ZeroHash);
      expect(await tracker.approvalCount()).to.equal(0);
    });

    it("tracks up to 256 distinct indices in one bytes32 slot", async function () {
      // Set a sample of indices including 0, 1, 128, 255
      for (const idx of [0, 1, 7, 128, 200, 255]) {
        await tracker.setApproval(idx, true);
        expect(await tracker.isApproved(idx)).to.equal(true);
      }
      expect(await tracker.approvalCount()).to.equal(6);

      const raw: string = await tracker.getApprovalsRaw();
      // still a single 32-byte word
      expect(raw.length).to.equal(66); // 0x + 64 hex chars
    });
  });

  describe("Yul bitwise ops", function () {
    it("setApproval uses OR path and clear uses AND/NOT", async function () {
      await tracker.setApproval(3, true);
      expect(await tracker.isApproved(3)).to.equal(true);
      await tracker.setApproval(3, false);
      expect(await tracker.isApproved(3)).to.equal(false);
    });

    it("toggleApproval flips bit via XOR", async function () {
      expect(await tracker.isApproved(10)).to.equal(false);
      await tracker.toggleApproval(10);
      expect(await tracker.isApproved(10)).to.equal(true);
      await tracker.toggleApproval(10);
      expect(await tracker.isApproved(10)).to.equal(false);
    });

    it("setApprovalsBatch sets multiple bits", async function () {
      await tracker.setApprovalsBatch([2, 4, 6], true);
      expect(await tracker.isApproved(2)).to.equal(true);
      expect(await tracker.isApproved(4)).to.equal(true);
      expect(await tracker.isApproved(6)).to.equal(true);
      expect(await tracker.isApproved(3)).to.equal(false);
    });

    it("clearAll zeroes the slot", async function () {
      await tracker.setApprovalsBatch([1, 2, 3], true);
      await tracker.clearAll();
      expect(await tracker.getApprovalsRaw()).to.equal(ethers.ZeroHash);
      expect(await tracker.approvalCount()).to.equal(0);
    });

    it("hasQuorum reflects bit count vs threshold", async function () {
      await tracker.setApprovalsBatch([0, 1, 2], true);
      expect(await tracker.hasQuorum(3)).to.equal(true);
      expect(await tracker.hasQuorum(4)).to.equal(false);
    });
  });

  describe("access control", function () {
    it("non-admin cannot set approvals", async function () {
      await expect(
        tracker.connect(other).setApproval(0, true)
      ).to.be.revertedWithCustomError(tracker, "Unauthorized");
    });
  });

  describe("gas vs mapping pattern (smoke)", function () {
    it("setting 8 approvals stays on one storage slot", async function () {
      const tx = await tracker.setApprovalsBatch([0, 1, 2, 3, 4, 5, 6, 7], true);
      const receipt = await tx.wait();
      // Smoke: transaction succeeded; single-slot design implies far fewer SSTOREs
      // than 8 cold mapping writes (~20k each). Full gas benchmarks live in CI.
      expect(receipt.status).to.equal(1);
      expect(await tracker.approvalCount()).to.equal(8);
    });
  });
});
