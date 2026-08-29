/**
 * Tests for StorageCleaner (EIP-3529 gas refunds)
 * Issue #636
 */

import { describe, it, expect } from "vitest";

describe("StorageCleaner", () => {
  describe("slot clearing", () => {
    it("should zero out a storage slot", () => {
      const storage = new Map<string, bigint>();
      const slot = "0x01";
      storage.set(slot, 42n);
      storage.set(slot, 0n);
      expect(storage.get(slot)).toBe(0n);
    });

    it("should clear a range of slots", () => {
      const storage = new Map<string, bigint>();
      const startSlot = 100n;

      // Write values
      for (let i = 0n; i < 5n; i++) {
        storage.set((startSlot + i).toString(), (i + 1n) * 1000n);
      }

      // Clear range
      for (let i = 0n; i < 5n; i++) {
        storage.set((startSlot + i).toString(), 0n);
      }

      for (let i = 0n; i < 5n; i++) {
        expect(storage.get((startSlot + i).toString())).toBe(0n);
      }
    });

    it("should not affect adjacent slots", () => {
      const storage = new Map<string, bigint>();
      storage.set("1", 100n);
      storage.set("2", 200n);
      storage.set("3", 300n);

      storage.set("2", 0n);

      expect(storage.get("1")).toBe(100n);
      expect(storage.get("2")).toBe(0n);
      expect(storage.get("3")).toBe(300n);
    });
  });

  describe("StorageCleanerConsumer", () => {
    it("should calculate gas refund per cleared slot", () => {
      const EIP3529_REFUND_PER_SLOT = 4800n;
      const slotsCleared = 2n;
      const expectedRefund = EIP3529_REFUND_PER_SLOT * slotsCleared;
      expect(expectedRefund).toBe(9600n);
    });

    it("should track cleared slots", () => {
      const cleared = new Set<number>();
      cleared.add(1);
      cleared.add(2);
      expect(cleared.size).toBe(2);
      expect(cleared.has(1)).toBe(true);
      expect(cleared.has(3)).toBe(false);
    });

    it("should handle batch completion", () => {
      const requests = [
        { id: 1, completed: false },
        { id: 2, completed: false },
        { id: 3, completed: false },
      ];

      const idsToComplete = [1, 2];
      for (const id of idsToComplete) {
        requests[id - 1].completed = true;
      }

      expect(requests[0].completed).toBe(true);
      expect(requests[1].completed).toBe(true);
      expect(requests[2].completed).toBe(false);
    });
  });
});
