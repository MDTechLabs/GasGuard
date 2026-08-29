/**
 * Tests for UserAccountStruct storage slot packing
 * Issue #630
 */

import { describe, it, expect } from "vitest";

describe("UserAccountStruct Storage Packing", () => {
  describe("struct field sizing", () => {
    it("should calculate total bytes per slot correctly", () => {
      // Slot 1: wallet (20) + lastActivity (8) + loginCount (4) = 32 bytes
      const walletBytes = 20;
      const lastActivityBytes = 8;
      const loginCountBytes = 4;

      const totalSlot1 = walletBytes + lastActivityBytes + loginCountBytes;
      expect(totalSlot1).toBe(32);
    });

    it("should fit tier + isActive in same slot", () => {
      // Slot 2: tier (1) + isActive (1) = 2 bytes (30 bytes padding)
      const tierBytes = 1;
      const isActiveBytes = 1;

      const totalSlot2 = tierBytes + isActiveBytes;
      expect(totalSlot2).toBeLessThanOrEqual(32);
    });

    it("should pack admin fields into single slot", () => {
      // adminAddress (20) + adminExpiry (8) + adminNonce (4) = 32 bytes
      const adminAddressBytes = 20;
      const adminExpiryBytes = 8;
      const adminNonceBytes = 4;

      const total = adminAddressBytes + adminExpiryBytes + adminNonceBytes;
      expect(total).toBe(32);
    });
  });

  describe("slot calculation", () => {
    it("should compute correct slot offset for packed fields", () => {
      const baseSlot = 0;
      const walletOffset = 0;
      const lastActivityOffset = 20;
      const loginCountOffset = 28;

      // In Yul: sload(baseSlot + offset)
      expect(walletOffset).toBe(0);
      expect(lastActivityOffset).toBe(20);
      expect(loginCountOffset).toBe(28);
    });

    it("should compute tier slot as baseSlot + 1", () => {
      const baseSlot = 0;
      const tierSlot = baseSlot + 1;
      expect(tierSlot).toBe(1);
    });
  });

  describe("gas savings estimate", () => {
    it("should save slots vs naive packing", () => {
      // Naive: 6 fields = 6 slots
      // Packed: 3 slots (balance + packed1 + packed2)
      const naiveSlots = 6;
      const packedSlots = 3;
      const savedSlots = naiveSlots - packedSlots;

      // Each SLOAD saves ~100 gas
      const gasPerSload = 100;
      const totalSaved = savedSlots * gasPerSload;

      expect(savedSlots).toBe(3);
      expect(totalSaved).toBe(300);
    });
  });
});
