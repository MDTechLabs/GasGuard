import { expect } from "chai";
import { ethers } from "hardhat";
import type { Contract } from "ethers";

describe("BitmaskConfig", function () {
  let config: Contract;

  beforeEach(async function () {
    const Factory = await ethers.getContractFactory("BitmaskConfig");
    config = await Factory.deploy();
    await config.waitForDeployment();
  });

  describe("initial state", function () {
    it("should have all flags set to false initially", async function () {
      expect(await config.isPaused()).to.equal(false);
      expect(await config.isLocked()).to.equal(false);
      expect(await config.isPublic()).to.equal(false);
      expect(await config.isMigrated()).to.equal(false);
    });

    it("should have a zero raw config initially", async function () {
      expect(await config.getRawConfig()).to.equal(ethers.ZeroHash);
    });
  });

  describe("setting flags", function () {
    it("should set paused flag", async function () {
      await config.setPaused(true);
      expect(await config.isPaused()).to.equal(true);
      expect(await config.isLocked()).to.equal(false);
    });

    it("should clear paused flag", async function () {
      await config.setPaused(true);
      await config.setPaused(false);
      expect(await config.isPaused()).to.equal(false);
    });

    it("should set multiple flags independently", async function () {
      await config.setPaused(true);
      await config.setPublic(true);
      expect(await config.isPaused()).to.equal(true);
      expect(await config.isPublic()).to.equal(true);
      expect(await config.isLocked()).to.equal(false);
    });

    it("should not affect other flags when toggling one", async function () {
      await config.setPaused(true);
      await config.setMigrated(true);
      const raw = await config.getRawConfig();
      // PAUSED_BIT (0x01) | MIGRATED_BIT (0x08) = 0x09
      expect(raw).to.equal("0x09");
      await config.setPaused(false);
      expect(await config.isPaused()).to.equal(false);
      expect(await config.isMigrated()).to.equal(true);
    });

    it("should emit ConfigUpdated event on flag change", async function () {
      await expect(config.setLocked(true)).to.emit(config, "ConfigUpdated");
    });
  });

  describe("bitmask integrity", function () {
    it("should maintain correct raw bitmask for all flag combinations", async function () {
      // All off → 0x00
      expect(await config.getRawConfig()).to.equal("0x00");

      await config.setPaused(true);
      expect(await config.getRawConfig()).to.equal("0x01");

      await config.setLocked(true);
      expect(await config.getRawConfig()).to.equal("0x03");

      await config.setPublic(true);
      expect(await config.getRawConfig()).to.equal("0x07");

      await config.setMigrated(true);
      expect(await config.getRawConfig()).to.equal("0x0f");
    });
  });
});
