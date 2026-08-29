import { expect } from "chai";
import { ethers } from "hardhat";
import type { Contract } from "ethers";

interface PackedEntry {
  recipient: string;
  amount: bigint;
}

function packEntries(entries: PackedEntry[]): string {
  return ethers.concat(
    entries.map((entry) =>
      ethers.solidityPacked(
        ["address", "uint96"],
        [entry.recipient, entry.amount],
      ),
    ),
  );
}

function abiEncodeEntries(entries: PackedEntry[]): string {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  return coder.encode(
    ["tuple(address recipient, uint96 amount)[]"],
    [entries.map((e) => [e.recipient, e.amount])],
  );
}

describe("CalldataUnpacker", function () {
  let unpacker: Contract;
  let entries: PackedEntry[];

  beforeEach(async function () {
    const Unpacker = await ethers.getContractFactory("CalldataUnpacker");
    unpacker = await Unpacker.deploy();
    await unpacker.waitForDeployment();

    const signers = await ethers.getSigners();
    entries = signers.slice(0, 3).map((signer, i) => ({
      recipient: signer.address,
      amount: BigInt(1000 * (i + 1)),
    }));
  });

  describe("decodeEntryAt", function () {
    it("decodes a single packed entry's address and amount", async function () {
      const payload = packEntries(entries);
      const [recipient, amount] = await unpacker.decodeEntryAt(payload, 1);

      expect(recipient).to.equal(entries[1].recipient);
      expect(amount).to.equal(entries[1].amount);
    });
  });

  describe("unpackBatch", function () {
    it("credits totalReceived and emits an event for every packed entry", async function () {
      const payload = packEntries(entries);

      await expect(unpacker.unpackBatch(payload))
        .to.emit(unpacker, "Unpacked")
        .withArgs(entries[0].recipient, entries[0].amount);

      for (const entry of entries) {
        expect(await unpacker.totalReceived(entry.recipient)).to.equal(
          entry.amount,
        );
      }
    });

    it("returns the number of entries processed", async function () {
      const payload = packEntries(entries);
      const processed = await unpacker.unpackBatch.staticCall(payload);
      expect(processed).to.equal(entries.length);
    });

    it("reverts when the payload length is not a multiple of 32 bytes", async function () {
      const malformed = ethers.concat([packEntries(entries), "0x00"]);
      await expect(
        unpacker.unpackBatch(malformed),
      ).to.be.revertedWithCustomError(unpacker, "InvalidPayloadLength");
    });

    it("reverts on an empty payload", async function () {
      await expect(unpacker.unpackBatch("0x")).to.be.revertedWithCustomError(
        unpacker,
        "InvalidPayloadLength",
      );
    });
  });

  describe("gas comparison vs. abi.decode baseline", function () {
    it("unpackBatch uses meaningfully less gas than the abi.decode baseline", async function () {
      const packedPayload = packEntries(entries);
      const abiPayload = abiEncodeEntries(entries);

      const packedReceipt = await (
        await unpacker.unpackBatch(packedPayload)
      ).wait();

      // Fresh contract so totals/state don't carry over between the two paths.
      const Unpacker = await ethers.getContractFactory("CalldataUnpacker");
      const baselineUnpacker = await Unpacker.deploy();
      await baselineUnpacker.waitForDeployment();
      const abiReceipt = await (
        await baselineUnpacker.multicallAbiDecodeBaseline(abiPayload)
      ).wait();

      const packedGas = Number(packedReceipt.gasUsed);
      const abiGas = Number(abiReceipt.gasUsed);
      const savingsPerItem = (abiGas - packedGas) / entries.length;

      console.log(
        `      packed calldata bytes: ${(packedPayload.length - 2) / 2}`,
      );
      console.log(
        `      abi.decode calldata bytes: ${(abiPayload.length - 2) / 2}`,
      );
      console.log(`      unpackBatch gas: ${packedGas}`);
      console.log(`      abi.decode baseline gas: ${abiGas}`);
      console.log(`      gas saved per item: ${savingsPerItem}`);

      expect(packedGas).to.be.lessThan(abiGas);
    });
  });
});
