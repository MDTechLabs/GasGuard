import { expect } from "chai";
import { ethers } from "hardhat";
import type { Contract } from "ethers";

describe("EventRegistry", () => {
  let registry: Contract;

  beforeEach(async function () {
    const Factory = await ethers.getContractFactory("EventRegistry");
    registry = await Factory.deploy();
    await registry.waitForDeployment();
  });

  it("should inline constant event topic selectors matching their canonical ABI signatures", async () => {
    expect(await registry.EVENT_TRANSFER_TOPIC()).to.equal(
      ethers.id("Transfer(address,address,uint256)"),
    );
    expect(await registry.EVENT_APPROVAL_TOPIC()).to.equal(
      ethers.id("Approval(address,address,uint256)"),
    );
    expect(await registry.EVENT_APPROVAL_FOR_ALL_TOPIC()).to.equal(
      ethers.id("ApprovalForAll(address,address,bool)"),
    );
    expect(await registry.EVENT_OWNERSHIP_TRANSFERRED_TOPIC()).to.equal(
      ethers.id("OwnershipTransferred(address,address)"),
    );
  });

  it("should emit LogRegistered with the pre-computed transfer topic", async () => {
    const [, emitter] = await ethers.getSigners();
    const transferTopic = await registry.EVENT_TRANSFER_TOPIC();

    await expect(registry.logEvent(emitter.address))
      .to.emit(registry, "LogRegistered")
      .withArgs(transferTopic, emitter.address);
  });

  it("should emit a raw Approval-shaped log via assembly using the constant topic0", async () => {
    const [owner, spender] = await ethers.getSigners();
    const approvalTopic = await registry.EVENT_APPROVAL_TOPIC();

    const tx = await registry.emitViaAssembly(
      owner.address,
      spender.address,
      42n,
    );
    const receipt = await tx.wait();

    const log = receipt!.logs.find(
      (l: { address: string }) => l.address === (await registry.getAddress()),
    );
    expect(log).to.not.be.undefined;
    expect(log!.topics[0]).to.equal(approvalTopic);
    expect(ethers.getAddress("0x" + log!.topics[1].slice(26))).to.equal(
      owner.address,
    );
    expect(ethers.getAddress("0x" + log!.topics[2].slice(26))).to.equal(
      spender.address,
    );
    expect(BigInt(log!.data)).to.equal(42n);
  });
});
