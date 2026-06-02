/**
 * Soroban Contract State Snapshot Exporter Tests
 */

import { SorobanSnapshotExporter } from "./snapshot-exporter";
import { ContractStateSnapshot, SnapshotExportConfig } from "./types";

describe("SorobanSnapshotExporter", () => {
  let exporter: SorobanSnapshotExporter;
  const testRpcUrl = "https://soroban-testnet.stellar.org";
  const testContractId =
    "CDLZVWRQK6QZL4QF5VQKQZL4QF5VQKQZL4QF5VQKQZL4QF5VQKQZL4QF";

  beforeEach(() => {
    exporter = new SorobanSnapshotExporter(testRpcUrl);
  });

  describe("constructor", () => {
    it("should create an instance with default config", () => {
      expect(exporter).toBeDefined();
    });

    it("should create an instance with custom config", () => {
      const config: Partial<SnapshotExportConfig> = {
        includeStorage: false,
        maxEntries: 100,
      };
      const customExporter = new SorobanSnapshotExporter(testRpcUrl, config);
      expect(customExporter).toBeDefined();
    });
  });

  describe("validateSnapshot", () => {
    it("should validate a correct snapshot", () => {
      const validSnapshot: ContractStateSnapshot = {
        snapshotId: "test-snapshot-1",
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
            key: "balance",
            value: "AAAADwAAAAl0b2tlbl9iYWwAAAA=",
            storageType: "persistent",
            capturedAt: Date.now(),
          },
        ],
      };

      const result = exporter.validateSnapshot(validSnapshot);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject snapshot with missing contract ID", () => {
      const invalidSnapshot: any = {
        snapshotId: "test-snapshot-2",
        version: "1.0.0",
        metadata: {
          contractId: "",
          networkPassphrase: "Test SDF Network ; September 2015",
          networkUrl: testRpcUrl,
          ledgerSequence: 12345,
          timestamp: Date.now(),
        },
        storageEntries: [],
      };

      const result = exporter.validateSnapshot(invalidSnapshot);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing contract ID in metadata");
    });

    it("should reject snapshot with missing network passphrase", () => {
      const invalidSnapshot: any = {
        snapshotId: "test-snapshot-3",
        version: "1.0.0",
        metadata: {
          contractId: testContractId,
          networkPassphrase: "",
          networkUrl: testRpcUrl,
          ledgerSequence: 12345,
          timestamp: Date.now(),
        },
        storageEntries: [],
      };

      const result = exporter.validateSnapshot(invalidSnapshot);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing network passphrase in metadata");
    });

    it("should reject snapshot with invalid ledger sequence", () => {
      const invalidSnapshot: any = {
        snapshotId: "test-snapshot-4",
        version: "1.0.0",
        metadata: {
          contractId: testContractId,
          networkPassphrase: "Test SDF Network ; September 2015",
          networkUrl: testRpcUrl,
          ledgerSequence: -1,
          timestamp: Date.now(),
        },
        storageEntries: [],
      };

      const result = exporter.validateSnapshot(invalidSnapshot);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Invalid ledger sequence in metadata");
    });

    it("should warn about empty storage entries", () => {
      const validSnapshot: ContractStateSnapshot = {
        snapshotId: "test-snapshot-5",
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

      const result = exporter.validateSnapshot(validSnapshot);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain("Snapshot contains no storage entries");
    });

    it("should warn about large number of entries", () => {
      const largeSnapshot: ContractStateSnapshot = {
        snapshotId: "test-snapshot-6",
        version: "1.0.0",
        metadata: {
          contractId: testContractId,
          networkPassphrase: "Test SDF Network ; September 2015",
          networkUrl: testRpcUrl,
          ledgerSequence: 12345,
          timestamp: Date.now(),
        },
        storageEntries: Array(1001).fill({
          key: "test-key",
          value: "test-value",
          storageType: "persistent" as const,
          capturedAt: Date.now(),
        }),
      };

      const result = exporter.validateSnapshot(largeSnapshot);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain(
        "Snapshot contains a large number of entries (>1000)",
      );
    });

    it("should reject snapshot with invalid storage type", () => {
      const invalidSnapshot: any = {
        snapshotId: "test-snapshot-7",
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
            storageType: "invalid-type",
            capturedAt: Date.now(),
          },
        ],
      };

      const result = exporter.validateSnapshot(invalidSnapshot);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("invalid storage type");
    });
  });

  describe("exportToJson", () => {
    it("should export snapshot to JSON string", () => {
      const snapshot: ContractStateSnapshot = {
        snapshotId: "test-snapshot-json",
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

      const json = exporter.exportToJson(snapshot);
      expect(typeof json).toBe("string");

      const parsed = JSON.parse(json);
      expect(parsed.snapshotId).toBe("test-snapshot-json");
      expect(parsed.metadata.contractId).toBe(testContractId);
    });

    it("should produce valid JSON that can be parsed", () => {
      const snapshot: ContractStateSnapshot = {
        snapshotId: "test-snapshot-parse",
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
            ttlExpiration: 100000,
            capturedAt: Date.now(),
          },
        ],
      };

      const json = exporter.exportToJson(snapshot);
      const parsed = JSON.parse(json);

      expect(parsed.storageEntries).toHaveLength(1);
      expect(parsed.storageEntries[0].key).toBe("counter");
      expect(parsed.storageEntries[0].storageType).toBe("persistent");
    });
  });

  describe("importFromJson", () => {
    it("should import snapshot from JSON string", () => {
      const jsonString = JSON.stringify({
        snapshotId: "imported-snapshot",
        version: "1.0.0",
        metadata: {
          contractId: testContractId,
          networkPassphrase: "Test SDF Network ; September 2015",
          networkUrl: testRpcUrl,
          ledgerSequence: 54321,
          timestamp: Date.now(),
        },
        storageEntries: [],
      });

      const snapshot = exporter.importFromJson(jsonString);
      expect(snapshot.snapshotId).toBe("imported-snapshot");
      expect(snapshot.metadata.ledgerSequence).toBe(54321);
    });

    it("should throw error on invalid JSON", () => {
      const invalidJson = "{ invalid json }";
      expect(() => exporter.importFromJson(invalidJson)).toThrow();
    });

    it("should preserve all snapshot data during import", () => {
      const originalSnapshot: ContractStateSnapshot = {
        snapshotId: "roundtrip-test",
        version: "1.0.0",
        metadata: {
          contractId: testContractId,
          networkPassphrase: "Test SDF Network ; September 2015",
          networkUrl: testRpcUrl,
          ledgerSequence: 99999,
          timestamp: Date.now(),
          sourceFilePath: "/path/to/contract.rs",
          contractName: "TestContract",
        },
        storageEntries: [
          {
            key: "owner",
            value: "AAAAAQ==",
            storageType: "instance",
            capturedAt: Date.now(),
          },
          {
            key: "balance",
            value: "AAAACw==",
            storageType: "persistent",
            ttlExpiration: 200000,
            capturedAt: Date.now(),
          },
        ],
        description: "Test snapshot for roundtrip",
        tags: ["test", "development"],
      };

      const json = exporter.exportToJson(originalSnapshot);
      const imported = exporter.importFromJson(json);

      expect(imported.snapshotId).toBe(originalSnapshot.snapshotId);
      expect(imported.metadata.contractName).toBe("TestContract");
      expect(imported.storageEntries).toHaveLength(2);
      expect(imported.description).toBe("Test snapshot for roundtrip");
      expect(imported.tags).toEqual(["test", "development"]);
    });
  });

  describe("exportSnapshot", () => {
    it("should return error for invalid contract ID", async () => {
      const invalidContractId = "invalid-id";

      const result = await exporter.exportSnapshot(invalidContractId);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.entriesExported).toBe(0);
    }, 10000);

    it("should measure export duration", async () => {
      // This will fail due to network but should still measure duration
      const result = await exporter.exportSnapshot(testContractId);

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    }, 10000);
  });
});
