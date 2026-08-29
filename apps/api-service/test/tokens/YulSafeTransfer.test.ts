import { expect } from "chai";
import { network } from "hardhat";

describe("YulSafeTransfer", () => {
  async function deployFixture() {
    const { ethers } = await network.create();
    const [deployer, alice, bob] = await ethers.getSigners();

    const harnessFactory = await ethers.getContractFactory("YulSafeTransferHarness");
    const deployed = await harnessFactory.deploy();
    const harnessAddress = await deployed.getAddress();

    // `TransferFailed` is declared on the `YulSafeTransfer` library, not on
    // the harness itself, so the harness's own solc-generated ABI doesn't
    // list it even though its bytecode can revert with it (the library's
    // internal function is inlined into the harness). Merge in the
    // library's error-only ABI so `revertedWithCustomError` can decode it.
    const libraryFactory = await ethers.getContractFactory("YulSafeTransfer");
    const combinedInterface = new ethers.Interface([
      ...deployed.interface.fragments,
      ...libraryFactory.interface.fragments,
    ]);
    const harness = new ethers.Contract(harnessAddress, combinedInterface, deployed.runner);

    const standardToken = await (await ethers.getContractFactory("MockERC20")).deploy();
    const nonStandardToken = await (await ethers.getContractFactory("NonStandardERC20")).deploy();
    const revertingToken = await (await ethers.getContractFactory("RevertingERC20")).deploy();
    const falseReturningToken = await (await ethers.getContractFactory("FalseReturningERC20")).deploy();

    return { ethers, deployer, alice, bob, harness, harnessAddress, standardToken, nonStandardToken, revertingToken, falseReturningToken };
  }

  describe("safeTransfer", () => {
    it("succeeds against a standard-compliant token that returns true", async () => {
      const { harness, harnessAddress, standardToken, bob } = await deployFixture();
      await (await standardToken.mint(harnessAddress, 1_000n)).wait();

      await (await harness.safeTransfer(await standardToken.getAddress(), bob.address, 400n)).wait();

      expect(await standardToken.balanceOf(bob.address)).to.equal(400n);
      expect(await standardToken.balanceOf(harnessAddress)).to.equal(600n);
    });

    it("succeeds against a non-standard token that returns nothing (USDT-style)", async () => {
      const { harness, harnessAddress, nonStandardToken, bob } = await deployFixture();
      await (await nonStandardToken.mint(harnessAddress, 1_000n)).wait();

      await (await harness.safeTransfer(await nonStandardToken.getAddress(), bob.address, 250n)).wait();

      expect(await nonStandardToken.balanceOf(bob.address)).to.equal(250n);
      expect(await nonStandardToken.balanceOf(harnessAddress)).to.equal(750n);
    });

    it("bubbles up the original revert reason when the token call reverts", async () => {
      const { harness, revertingToken, bob } = await deployFixture();

      await expect(harness.safeTransfer(await revertingToken.getAddress(), bob.address, 1n)).to.be.revertedWith(
        "RevertingERC20: transfer disabled",
      );
    });

    it("reverts with TransferFailed() when the token returns false", async () => {
      const { harness, falseReturningToken, bob } = await deployFixture();

      await expect(
        harness.safeTransfer(await falseReturningToken.getAddress(), bob.address, 1n),
      ).to.be.revertedWithCustomError(harness, "TransferFailed");
    });

    it("bubbles up a require-style revert reason from a standard token running out of balance", async () => {
      const { harness, standardToken, bob } = await deployFixture();
      // harness holds zero balance of standardToken here.
      await expect(harness.safeTransfer(await standardToken.getAddress(), bob.address, 1n)).to.be.revertedWith(
        "MockERC20: insufficient balance",
      );
    });
  });

  describe("safeTransferFrom", () => {
    it("succeeds against a standard-compliant token that returns true", async () => {
      const { harness, harnessAddress, standardToken, alice, bob } = await deployFixture();
      await (await standardToken.mint(alice.address, 1_000n)).wait();
      await (await standardToken.connect(alice).approve(harnessAddress, 1_000n)).wait();

      await (
        await harness.safeTransferFrom(await standardToken.getAddress(), alice.address, bob.address, 300n)
      ).wait();

      expect(await standardToken.balanceOf(alice.address)).to.equal(700n);
      expect(await standardToken.balanceOf(bob.address)).to.equal(300n);
    });

    it("succeeds against a non-standard token that returns nothing (USDT-style)", async () => {
      const { harness, harnessAddress, nonStandardToken, alice, bob } = await deployFixture();
      await (await nonStandardToken.mint(alice.address, 1_000n)).wait();
      await (await nonStandardToken.connect(alice).approve(harnessAddress, 1_000n)).wait();

      await (
        await harness.safeTransferFrom(await nonStandardToken.getAddress(), alice.address, bob.address, 600n)
      ).wait();

      expect(await nonStandardToken.balanceOf(alice.address)).to.equal(400n);
      expect(await nonStandardToken.balanceOf(bob.address)).to.equal(600n);
    });

    it("bubbles up the original revert reason when the token call reverts", async () => {
      const { harness, revertingToken, alice, bob } = await deployFixture();

      await expect(
        harness.safeTransferFrom(await revertingToken.getAddress(), alice.address, bob.address, 1n),
      ).to.be.revertedWith("RevertingERC20: transfer disabled");
    });

    it("reverts with TransferFailed() when the token returns false", async () => {
      const { harness, falseReturningToken, alice, bob } = await deployFixture();

      await expect(
        harness.safeTransferFrom(await falseReturningToken.getAddress(), alice.address, bob.address, 1n),
      ).to.be.revertedWithCustomError(harness, "TransferFailed");
    });

    it("bubbles up a require-style revert reason when the harness lacks allowance", async () => {
      const { harness, standardToken, alice, bob } = await deployFixture();
      await (await standardToken.mint(alice.address, 1_000n)).wait();
      // No approve() call: allowance is zero.

      await expect(
        harness.safeTransferFrom(await standardToken.getAddress(), alice.address, bob.address, 1n),
      ).to.be.revertedWith("MockERC20: insufficient allowance");
    });
  });

  describe("calling a non-contract address", () => {
    it("succeeds, since an EOA call is indistinguishable from a USDT-style success", async () => {
      const { ethers, harness, bob } = await deployFixture();
      // An EOA has no code; the low-level `call` itself still "succeeds" at
      // the EVM level with empty returndata, which YulSafeTransfer treats as
      // the USDT-style success case. This documents that behavior rather
      // than asserting a revert, since there's no way to distinguish an EOA
      // from a non-standard token purely from a CALL's outcome.
      await expect(harness.safeTransfer(bob.address, bob.address, 1n)).to.not.revert(ethers);
    });
  });
});
