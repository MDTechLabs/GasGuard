import { expect } from "chai";
import { ethers } from "hardhat";
import type { Contract } from "ethers";

describe("ZeroCopyRouter", function () {
  let router: Contract;
  let target: Contract;

  beforeEach(async function () {
    // Deploy a simple target contract that echoes back data.
    const TargetFactory = await ethers.getContractFactory("DirectIndexRouter");
    target = await TargetFactory.deploy();
    await target.waitForDeployment();
    await target.initialize(await (await ethers.getSigners())[0].getAddress());

    const RouterFactory = await ethers.getContractFactory("ZeroCopyRouter");
    router = await RouterFactory.deploy();
    await router.waitForDeployment();
  });

  describe("batch execution", function () {
    it("should execute a single delegatecall successfully", async function () {
      // Pack: [address (20B)] [uint16 payloadLen] [payload]
      const targetAddr = ethers.zeroPadValue(await target.getAddress(), 20);

      // payload: deposit(user, amount) selector + args
      const depositSelector = target.interface.encodeFunctionData("deposit", [
        ethers.ZeroAddress,
        0n,
      ]);

      const payloadLen = ethers.toBeHex(depositSelector.length, 2);
      const packed = ethers.concat([targetAddr, payloadLen, depositSelector]);

      // Add padding to make it a valid bytes calldata
      const iface = new ethers.Interface(["function batchExecute(bytes)"]);
      const calldata = iface.encodeFunctionData("batchExecute", [packed]);

      // Submit via low-level call since the router expects specific calldata layout
      const tx = await ethers.provider.call({
        to: await router.getAddress(),
        data: calldata,
      });

      // Verify the router processed the batch
      const results = iface.decodeFunctionResult("batchExecute", tx)[0];
      expect(results.length).to.be.greaterThan(0);
    });

    it("should reject malformed calldata gracefully", async function () {
      const iface = new ethers.Interface(["function batchExecute(bytes)"]);
      // Send empty bytes — should return empty results.
      const calldata = iface.encodeFunctionData("batchExecute", ["0x"]);
      const tx = await ethers.provider.call({
        to: await router.getAddress(),
        data: calldata,
      });
      const results = iface.decodeFunctionResult("batchExecute", tx)[0];
      expect(results.length).to.equal(0);
    });
  });
});
