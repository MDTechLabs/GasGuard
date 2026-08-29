import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, ContractFactory } from "ethers";

describe("TransientStateSnapshot", () => {
  let mockFactory: ContractFactory;
  let mock: Contract;

  const SLOT_A = ethers.id("storage.a");
  const SLOT_B = ethers.id("storage.b");
  const VALUE_A = ethers.hexlify(ethers.toUtf8Bytes("value_a")).padEnd(66, "0");
  const VALUE_B = ethers.hexlify(ethers.toUtf8Bytes("value_b")).padEnd(66, "0");
  const VALUE_ZERO = "0x" + "00".repeat(32);

  before(async () => {
    mockFactory = await ethers.getContractFactory("TransientStateSnapshotMock");
    mock = await mockFactory.deploy();
    await mock.waitForDeployment();
  });

  describe("single slot snapshot & rollback", () => {
    it("should snapshot a slot and rollback correctly", async () => {
      await mock.setSlot(SLOT_A, VALUE_A);
      expect(await mock.readSlot(SLOT_A)).to.equal(VALUE_A);

      await mock.snapshotAndRollbackSlot(
        SLOT_A,
        ethers.id("new_value").padEnd(66, "0"),
      );
      expect(await mock.readSlot(SLOT_A)).to.equal(VALUE_A);
    });

    it("should revert SlotNotTracked when rolling back untracked slot", async () => {
      await expect(
        mock.rollbackUntrackedSlot(SLOT_A),
      ).to.be.revertedWithCustomError(mock, "SlotNotTracked");
    });
  });

  describe("multi-slot snapshot & rollback", () => {
    it("should snapshot and rollback multiple slots", async () => {
      await mock.setSlot(SLOT_A, VALUE_A);
      await mock.setSlot(SLOT_B, VALUE_B);

      await mock.snapshotAndRollbackSlots(
        [SLOT_A, SLOT_B],
        ethers.id("new_val").padEnd(66, "0"),
      );

      expect(await mock.readSlot(SLOT_A)).to.equal(VALUE_A);
      expect(await mock.readSlot(SLOT_B)).to.equal(VALUE_B);
    });
  });

  describe("successful execution clears tracking", () => {
    it("should clear transient tracking after successful execution", async () => {
      await mock.setSlot(SLOT_A, VALUE_A);

      const tx = await mock.snapshotAndRollbackSlot(
        SLOT_A,
        ethers.id("new_value").padEnd(66, "0"),
      );

      expect(await mock.readSlot(SLOT_A)).to.equal(VALUE_A);
    });
  });

  describe("withRollback modifier", () => {
    it("should revert when the wrapped function reverts", async () => {
      await mock.setSlot(SLOT_A, VALUE_A);

      await expect(mock.executeWithRollback(SLOT_A, true)).to.be.revertedWith(
        "always revert",
      );

      expect(await mock.readSlot(SLOT_A)).to.equal(VALUE_A);
    });
  });

  describe("gas comparison", () => {
    it("should be more efficient than persistent storage approach", async () => {
      await mock.setSlot(SLOT_A, VALUE_A);

      const txPersistent = await mock.persistentBackupAndRestore(
        SLOT_A,
        ethers.id("tmp").padEnd(66, "0"),
      );
      const receiptPersistent = await txPersistent.wait();
      const gasPersistent = receiptPersistent!.gasUsed;

      await mock.setSlot(SLOT_A, VALUE_A);

      const txTransient = await mock.snapshotAndRollbackSlot(
        SLOT_A,
        ethers.id("tmp").padEnd(66, "0"),
      );
      const receiptTransient = await txTransient.wait();
      const gasTransient = receiptTransient!.gasUsed;

      expect(gasTransient).to.be.lessThan(gasPersistent);
    });
  });
});
