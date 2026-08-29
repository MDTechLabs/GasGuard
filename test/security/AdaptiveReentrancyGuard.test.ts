import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, ContractFactory } from "ethers";

describe("AdaptiveReentrancyGuard", () => {
  describe("transient mode", () => {
    let mock: Contract;

    before(async () => {
      const factory: ContractFactory = await ethers.getContractFactory(
        "AdaptiveReentrancyGuardMock",
      );
      mock = await factory.deploy(true);
      await mock.waitForDeployment();
    });

    it("should allow first entry", async () => {
      await expect(mock.enter()).to.not.be.reverted;
    });

    it("should reject reentrant call", async () => {
      await expect(mock.reenter()).to.be.reverted;
    });

    it("should allow re-entry after completion", async () => {
      await mock.enter();
      await expect(mock.enter()).to.not.be.reverted;
    });
  });

  describe("storage mode", () => {
    let mock: Contract;

    before(async () => {
      const factory: ContractFactory = await ethers.getContractFactory(
        "AdaptiveReentrancyGuardMock",
      );
      mock = await factory.deploy(false);
      await mock.waitForDeployment();
    });

    it("should allow first entry", async () => {
      await expect(mock.enter()).to.not.be.reverted;
    });

    it("should reject reentrant call with custom error", async () => {
      await expect(mock.reenter()).to.be.revertedWithCustomError(
        mock,
        "ReentrantCall",
      );
    });

    it("should allow re-entry after completion", async () => {
      await mock.enter();
      await expect(mock.enter()).to.not.be.reverted;
    });
  });

  describe("gas comparison", () => {
    it("should be more gas efficient in transient mode than storage mode", async () => {
      const transientFactory: ContractFactory = await ethers.getContractFactory(
        "AdaptiveReentrancyGuardMock",
      );
      const transientMock: Contract = await transientFactory.deploy(true);
      await transientMock.waitForDeployment();

      const storageFactory: ContractFactory = await ethers.getContractFactory(
        "AdaptiveReentrancyGuardMock",
      );
      const storageMock: Contract = await storageFactory.deploy(false);
      await storageMock.waitForDeployment();

      const txTransient = await transientMock.enter();
      const receiptTransient = await txTransient.wait();
      const gasTransient = receiptTransient!.gasUsed;

      const txStorage = await storageMock.enter();
      const receiptStorage = await txStorage.wait();
      const gasStorage = receiptStorage!.gasUsed;

      expect(gasTransient).to.be.lessThan(gasStorage);
    });
  });
});
