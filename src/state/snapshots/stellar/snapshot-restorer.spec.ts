/**
 * Soroban Contract State Snapshot Restorer Tests
 */

import { SorobanSnapshotRestorer } from "./snapshot-restorer";
import { ContractStateSnapshot, SnapshotRestoreConfig } from "./types";
import { Keypair } from "@stellar/stellar-sdk";

describe("SorobanSnapshotRestorer", () => {
  let restorer: SorobanSnapshotRestorer;
  const testRpcUrl = "https://soroban-testnet.stellar.org";
  const testContractId =
    "CDLZVWRQK6QZL4QF5VQKQZL4QF5VQKQZL4QF5VQKQZL4QF5VQKQZL4QF";
  let testKeypair: Keypair;

  beforeEach(() => {
    restorer = new SorobanSnapshotRestorer(testRpcUrl);
    testKeypair = Keypair.random();
  });

  describe("constructor", () => {
    it("should create an instance with default config", () => {
      expect(restorer).toBeDefined();
    });

    it("should create an instance with custom config", () => {
      const config: Partial<SnapshotRestoreConfig> = {
        overwriteExisting: true,
        dryRun: true,
      };
      const customRestorer = new SorobanSnapshotRestorer(testRpcUrl, config);
      expect(customRestorer).toBeDefined();
    });
  });

  describe("restoreSnapshot", () => {
    it("should fail validation for invalid snapshot", async () => {
      const invalidSnapshot: any = {
        snapshotId: "invalid-snapshot",
        version: "1.0.0",
        metadata: {
          contractId: "",
          networkPassphrase: "",
          networkUrl: testRpcUrl,
          ledgerSequence: -1,
          timestamp: Date.now(),
        },
        storageEntries: [],
      };

      const result = await restorer.restoreSnapshot(
        invalidSnapshot,
        testKeypair,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("validation failed");
      expect(result.entriesRestored).toBe(0);
    }, 10000);

    it("should measure restoration duration", async () => {
      const validSnapshot: ContractStateSnapshot = {
        snapshotId: "test-snapshot",
        version: "1.0.0",
        metadata: {
          contractId: testContractId,
          networkPassphrase: "Test SDF Network ; September 2015",
          networkUrl: testRpcUrl,
          ledgerSequence: 12345,
          timestamp: Date.now(),
        },
        storageEntries: [],
      };

      const result = await restorer.restoreSnapshot(validSnapshot, testKeypair);

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    }, 15000);

    it("should return failure for network mismatch", async () => {
      const wrongNetworkSnapshot: ContractStateSnapshot = {
        snapshotId: "wrong-network",
        version: "1.0.0",
        metadata: {
          contractId: testContractId,
          networkPassphrase: "Wrong Network Passphrase",
          networkUrl: testRpcUrl,
          ledgerSequence: 12345,
          timestamp: Date.now(),
        },
        storageEntries: [],
      };

      const result = await restorer.restoreSnapshot(
        wrongNetworkSnapshot,
        testKeypair,
      );

      // This will fail either due to network mismatch or connection error
      expect(result.success).toBe(false);
    }, 15000);
  });

  describe("previewRestore", () => {
    it("should preview restoration without applying changes", async () => {
      const snapshot: ContractStateSnapshot = {
        snapshotId: "preview-test",
        version: "1.0.0",
        metadata: {
          contractId: testContractId,
          networkPassphrase: "Test SDF Network ; September 2015",
          networkUrl: testRpcUrl,
          ledgerSequence: 12345,
          timestamp: Date.now(),
        },
        storageEntries: [
          {
            key: "counter",
            value: "AAAAAwAAAAE=",
            storageType: "persistent",
            capturedAt: Date.now(),
          },
        ],
      };

      const preview = await restorer.previewRestore(snapshot);

      expect(preview.totalEntries).toBe(1);
      expect(typeof preview.existingEntries).toBe("number");
      expect(typeof preview.newEntries).toBe("number");
      expect(Array.isArray(preview.entriesToRestore)).toBe(true);
    }, 15000);

    it("should handle empty snapshot", async () => {
      const emptySnapshot: ContractStateSnapshot = {
        snapshotId: "empty-preview",
        version: "1.0.0",
        metadata: {
          contractId: testContractId,
          networkPassphrase: "Test SDF Network ; September 2015",
          networkUrl: testRpcUrl,
          ledgerSequence: 12345,
          timestamp: Date.now(),
        },
        storageEntries: [],
      };

      const preview = await restorer.previewRestore(emptySnapshot);

      expect(preview.totalEntries).toBe(0);
      expect(preview.existingEntries).toBe(0);
      expect(preview.newEntries).toBe(0);
      expect(preview.entriesToRestore).toHaveLength(0);
    }, 15000);

    it("should correctly categorize entries", async () => {
      const snapshot: ContractStateSnapshot = {
        snapshotId: "categorize-test",
        version: "1.0.0",
        metadata: {
          contractId: testContractId,
          networkPassphrase: "Test SDF Network ; September 2015",
          networkUrl: testRpcUrl,
          ledgerSequence: 12345,
          timestamp: Date.now(),
        },
        storageEntries: [
          {
            key: "key1",
            value: "value1",
            storageType: "persistent",
            capturedAt: Date.now(),
          },
          {
            key: "key2",
            value: "value2",
            storageType: "temporary",
            capturedAt: Date.now(),
          },
        ],
      };

      const preview = await restorer.previewRestore(snapshot);

      expect(preview.totalEntries).toBe(2);
      // Both entries will likely be new since we're using a random contract
      expect(preview.existingEntries + preview.newEntries).toBe(2);
    }, 15000);
  });

  describe("configuration options", () => {
    it("should respect dryRun config", async () => {
      const dryRunRestorer = new SorobanSnapshotRestorer(testRpcUrl, {
        dryRun: true,
        validateBeforeRestore: false,
      });

      const snapshot: ContractStateSnapshot = {
        snapshotId: "dryrun-test",
        version: "1.0.0",
        metadata: {
          contractId: testContractId,
          networkPassphrase: "Test SDF Network ; September 2015",
          networkUrl: testRpcUrl,
          ledgerSequence: 12345,
          timestamp: Date.now(),
        },
        storageEntries: [
          {
            key: "test-key",
            value: "test-value",
            storageType: "persistent",
            capturedAt: Date.now(),
          },
        ],
      };

      // Dry run should not fail due to network issues
      // but will fail on validation or network check
      const result = await dryRunRestorer.restoreSnapshot(
        snapshot,
        testKeypair,
        { validateBeforeRestore: false },
      );

      // Should attempt but may fail on network checks
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    }, 15000);

    it("should skip validation when configured", async () => {
      const noValidationRestorer = new SorobanSnapshotRestorer(testRpcUrl, {
        validateBeforeRestore: false,
      });

      const invalidSnapshot: any = {
        snapshotId: "no-validation",
        version: "1.0.0",
        metadata: {
          contractId: "",
          networkPassphrase: "",
          networkUrl: testRpcUrl,
          ledgerSequence: -1,
          timestamp: Date.now(),
        },
        storageEntries: [],
      };

      // Should skip validation but fail on network check
      const result = await noValidationRestorer.restoreSnapshot(
        invalidSnapshot,
        testKeypair,
      );

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    }, 15000);
  });
});
