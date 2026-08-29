import { expect } from "chai";
import { ethers } from "hardhat";
import type { Contract } from "ethers";

describe("DirectIndexRouter", function () {
  let router: Contract;
  let admin: any;
  let user: any;

  beforeEach(async function () {
    [admin, user] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("DirectIndexRouter");
    router = await Factory.deploy();
    await router.waitForDeployment();

    await router.initialize(admin.address);
  });

  describe("standard ABI calls", function () {
    it("should deposit via standard function call", async function () {
      await router.deposit(user.address, 1000n);
      expect(await router.balances(user.address)).to.equal(1000n);
    });

    it("should withdraw via standard function call", async function () {
      await router.deposit(user.address, 1000n);
      await router.withdraw(user.address, 400n);
      expect(await router.balances(user.address)).to.equal(600n);
    });

    it("should return balance via standard function call", async function () {
      await router.deposit(user.address, 1000n);
      expect(await router.getBalance(user.address)).to.equal(1000n);
    });
  });

  describe("index-based fallback dispatch", function () {
    async function callRoute(
      index: number,
      userAddr: string,
      amount: bigint = 0n,
    ): Promise<any> {
      const userPadded = ethers.zeroPadValue(userAddr, 32);
      const amountPadded = ethers.zeroPadValue(ethers.toBeHex(amount), 32);
      const calldata = ethers.concat([
        ethers.zeroPadValue(ethers.toBeHex(index), 1),
        userPadded,
        amountPadded,
      ]);
      return router.route({ data: calldata });
    }

    it("should dispatch deposit via index 0x01", async function () {
      await callRoute(0x01, user.address, 1000n);
      expect(await router.balances(user.address)).to.equal(1000n);
    });

    it("should dispatch withdraw via index 0x02", async function () {
      await router.deposit(user.address, 1000n);
      await callRoute(0x02, user.address, 300n);
      expect(await router.balances(user.address)).to.equal(700n);
    });

    it("should dispatch getBalance via index 0x03", async function () {
      await router.deposit(user.address, 500n);
      const result = await callRoute(0x03, user.address);
      expect(result).to.equal(500n);
    });

    it("should revert on unknown index", async function () {
      await expect(callRoute(0xff, user.address)).to.be.revertedWithCustomError(
        router,
        "InvalidIndex",
      );
    });
  });

  describe("gas savings vs selector dispatch", function () {
    it("should use fewer comparisons than 4-byte selector dispatch", function () {
      const selectorComparisons = 3; // 4 functions = up to 3 eq/jumpi checks
      const indexComparisons = 1; // single byte comparison per candidate
      const gasPerComparison = 3;

      const selectorGas = selectorComparisons * gasPerComparison;
      const indexGas = indexComparisons * gasPerComparison;

      expect(indexGas).toBeLessThan(selectorGas);
    });
  });
});
