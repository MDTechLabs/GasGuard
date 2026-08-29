/**
 * Soroban Analysis Artifact Storage Tests
 *
 * Tests for artifact storage, retrieval, and metadata management.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import ArtifactStorageService from "./artifact-storage.service";
import ArtifactRetriever from "./artifact-retriever";
import MetadataManager from "./metadata-manager";
import {
  Artifact,
  ArtifactMetadata,
  ArtifactQuery,
  StorageResult,
} from "./types";

describe("ArtifactStorageService", () => {
  let tempDir: string;
  let storageService: ArtifactStorageService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-storage-"));
    storageService = new ArtifactStorageService({
      baseDir: tempDir,
      enableCompression: false,
      maxSizeBytes: 1024 * 1024,
      retentionMs: 0,
      verifyChecksum: true,
      createBackups: true,
      backupDir: path.join(tempDir, "backups"),
    });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe("store and retrieve artifacts", () => {
    it("should store artifact successfully", async () => {
      const metadata: ArtifactMetadata = {
        artifactId: "test-artifact-1",
        contractId: "CABC123",
        artifactType: "report",
        format: "json",
        network: "testnet",
        networkPassphrase: "Test SDF Network",
        ledgerSequence: 12345,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        generatedBy: "test-analyzer",
        toolVersion: "1.0.0",
        sizeBytes: 0,
      };

      const artifact: Artifact = {
        metadata,
        content: { summary: "Test artifact content" },
      };

      const result = await storageService.storeArtifact(artifact);

      expect(result.success).toBe(true);
      expect(result.artifactId).toBe("test-artifact-1");
      expect(result.filePath).toBeTruthy();
    });

    it("should retrieve stored artifact", async () => {
      const metadata: ArtifactMetadata = {
        artifactId: "test-artifact-2",
        contractId: "CABC123",
        artifactType: "snapshot",
        format: "json",
        network: "testnet",
        networkPassphrase: "Test SDF Network",
        ledgerSequence: 12345,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        generatedBy: "test-analyzer",
        toolVersion: "1.0.0",
        sizeBytes: 0,
      };

      const originalContent = { data: "test snapshot data" };
      const artifact: Artifact = {
        metadata,
        content: originalContent,
      };

      await storageService.storeArtifact(artifact);

      const retrieved = await storageService.retrieveArtifact(
        "CABC123",
        "test-artifact-2",
      );

      expect(retrieved).not.toBeNull();
      expect(retrieved!.metadata.artifactId).toBe("test-artifact-2");
      expect(retrieved!.content).toEqual(originalContent);
    });

    it("should prevent duplicate artifact without overwrite flag", async () => {
      const metadata: ArtifactMetadata = {
        artifactId: "test-artifact-3",
        contractId: "CABC123",
        artifactType: "analysis",
        format: "json",
        network: "testnet",
        networkPassphrase: "Test SDF Network",
        ledgerSequence: 12345,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        generatedBy: "test-analyzer",
        toolVersion: "1.0.0",
        sizeBytes: 0,
      };

      const artifact: Artifact = {
        metadata,
        content: { data: "original" },
      };

      await storageService.storeArtifact(artifact);
      const secondResult = await storageService.storeArtifact(artifact);

      expect(secondResult.success).toBe(false);
      expect(secondResult.error).toContain("already exists");
    });

    it("should overwrite artifact with overwrite flag", async () => {
      const metadata: ArtifactMetadata = {
        artifactId: "test-artifact-4",
        contractId: "CABC123",
        artifactType: "report",
        format: "json",
        network: "testnet",
        networkPassphrase: "Test SDF Network",
        ledgerSequence: 12345,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        generatedBy: "test-analyzer",
        toolVersion: "1.0.0",
        sizeBytes: 0,
      };

      const artifact1: Artifact = {
        metadata,
        content: { data: "version 1" },
      };

      await storageService.storeArtifact(artifact1);

      const artifact2: Artifact = {
        ...artifact1,
        content: { data: "version 2" },
      };

      const result = await storageService.storeArtifact(artifact2, {
        overwrite: true,
      });

      expect(result.success).toBe(true);

      const retrieved = await storageService.retrieveArtifact(
        "CABC123",
        "test-artifact-4",
      );
      expect(retrieved!.content).toEqual({ data: "version 2" });
    });
  });

  describe("query and search", () => {
    beforeEach(async () => {
      const artifacts: Artifact[] = [
        {
          metadata: {
            artifactId: "artifact-1",
            contractId: "CONTRACT-A",
            artifactType: "report",
            format: "json",
            network: "testnet",
            networkPassphrase: "Test SDF Network",
            ledgerSequence: 1000,
            createdAt: Date.now() - 10000,
            updatedAt: Date.now() - 10000,
            generatedBy: "analyzer-1",
            toolVersion: "1.0.0",
            sizeBytes: 0,
            tags: ["audit", "security"],
          },
          content: { type: "report" },
        },
        {
          metadata: {
            artifactId: "artifact-2",
            contractId: "CONTRACT-A",
            artifactType: "snapshot",
            format: "json",
            network: "mainnet",
            networkPassphrase: "Public Global Stellar Network",
            ledgerSequence: 2000,
            createdAt: Date.now() - 5000,
            updatedAt: Date.now() - 5000,
            generatedBy: "analyzer-1",
            toolVersion: "1.0.0",
            sizeBytes: 0,
            tags: ["state"],
          },
          content: { type: "snapshot" },
        },
        {
          metadata: {
            artifactId: "artifact-3",
            contractId: "CONTRACT-B",
            artifactType: "metrics",
            format: "json",
            network: "testnet",
            networkPassphrase: "Test SDF Network",
            ledgerSequence: 3000,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            generatedBy: "analyzer-2",
            toolVersion: "1.1.0",
            sizeBytes: 0,
          },
          content: { type: "metrics" },
        },
      ];

      for (const artifact of artifacts) {
        await storageService.storeArtifact(artifact);
      }
    });

    it("should query artifacts by contract ID", async () => {
      const query: ArtifactQuery = { contractId: "CONTRACT-A" };
      const results = await storageService.queryArtifacts(query);

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.contractId === "CONTRACT-A")).toBe(
        true,
      );
    });

    it("should query artifacts by type", async () => {
      const query: ArtifactQuery = { artifactType: "report" };
      const results = await storageService.queryArtifacts(query);

      expect(results).toHaveLength(1);
      expect(results[0].artifactType).toBe("report");
    });

    it("should query artifacts by network", async () => {
      const query: ArtifactQuery = { network: "mainnet" };
      const results = await storageService.queryArtifacts(query);

      expect(results).toHaveLength(1);
      expect(results[0].network).toBe("mainnet");
    });

    it("should query with pagination", async () => {
      const query: ArtifactQuery = { limit: 2, offset: 0 };
      const results = await storageService.queryArtifacts(query);

      expect(results.length).toBeLessThanOrEqual(2);
    });

    it("should sort query results", async () => {
      const query: ArtifactQuery = {
        sortBy: "createdAt",
        sortOrder: "desc",
      };
      const results = await storageService.queryArtifacts(query);

      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].createdAt).toBeGreaterThanOrEqual(
          results[i + 1].createdAt,
        );
      }
    });
  });

  describe("batch operations", () => {
    it("should store multiple artifacts", async () => {
      const artifacts: Artifact[] = [
        {
          metadata: {
            artifactId: "batch-1",
            contractId: "CONTRACT-X",
            artifactType: "report",
            format: "json",
            network: "testnet",
            networkPassphrase: "Test SDF Network",
            ledgerSequence: 1000,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            generatedBy: "batch-test",
            toolVersion: "1.0.0",
            sizeBytes: 0,
          },
          content: { item: 1 },
        },
        {
          metadata: {
            artifactId: "batch-2",
            contractId: "CONTRACT-X",
            artifactType: "analysis",
            format: "json",
            network: "testnet",
            networkPassphrase: "Test SDF Network",
            ledgerSequence: 1000,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            generatedBy: "batch-test",
            toolVersion: "1.0.0",
            sizeBytes: 0,
          },
          content: { item: 2 },
        },
      ];

      const result = await storageService.storeArtifactBatch(artifacts);

      expect(result.total).toBe(2);
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(0);
    });
  });

  describe("statistics", () => {
    beforeEach(async () => {
      const artifacts: Artifact[] = [
        {
          metadata: {
            artifactId: "stat-1",
            contractId: "CONTRACT-STAT",
            artifactType: "report",
            format: "json",
            network: "testnet",
            networkPassphrase: "Test SDF Network",
            ledgerSequence: 1000,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            generatedBy: "stats-test",
            toolVersion: "1.0.0",
            sizeBytes: 0,
          },
          content: { test: "data" },
        },
        {
          metadata: {
            artifactId: "stat-2",
            contractId: "CONTRACT-STAT",
            artifactType: "snapshot",
            format: "json",
            network: "mainnet",
            networkPassphrase: "Public Global Stellar Network",
            ledgerSequence: 2000,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            generatedBy: "stats-test",
            toolVersion: "1.0.0",
            sizeBytes: 0,
          },
          content: { test: "data" },
        },
      ];

      for (const artifact of artifacts) {
        await storageService.storeArtifact(artifact);
      }
    });

    it("should provide storage statistics", async () => {
      const stats = storageService.getStorageStatistics();

      expect(stats.totalArtifacts).toBeGreaterThan(0);
      expect(stats.totalSizeBytes).toBeGreaterThan(0);
      expect(stats.averageSizeBytes).toBeGreaterThan(0);
    });

    it("should track artifacts by type", async () => {
      const stats = storageService.getStorageStatistics();

      expect(stats.byType.report).toBeGreaterThan(0);
      expect(stats.byType.snapshot).toBeGreaterThan(0);
    });
  });

  describe("deletion", () => {
    it("should delete artifact", async () => {
      const metadata: ArtifactMetadata = {
        artifactId: "delete-test",
        contractId: "CONTRACT-DEL",
        artifactType: "report",
        format: "json",
        network: "testnet",
        networkPassphrase: "Test SDF Network",
        ledgerSequence: 1000,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        generatedBy: "delete-test",
        toolVersion: "1.0.0",
        sizeBytes: 0,
      };

      const artifact: Artifact = {
        metadata,
        content: { test: "data" },
      };

      await storageService.storeArtifact(artifact);

      const result = await storageService.deleteArtifact(
        "CONTRACT-DEL",
        "delete-test",
      );

      expect(result.success).toBe(true);

      const retrieved = await storageService.retrieveArtifact(
        "CONTRACT-DEL",
        "delete-test",
      );

      expect(retrieved).toBeNull();
    });
  });
});

describe("ArtifactRetriever", () => {
  let tempDir: string;
  let storageService: ArtifactStorageService;
  let retriever: ArtifactRetriever;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-retriever-"));
    storageService = new ArtifactStorageService({ baseDir: tempDir });
    retriever = new ArtifactRetriever(storageService, {
      enableCache: true,
      cacheTtlMs: 60000,
      maxCacheSize: 10,
    });

    // Store test artifact
    const artifact: Artifact = {
      metadata: {
        artifactId: "retriever-test",
        contractId: "CONTRACT-RETR",
        artifactType: "report",
        format: "json",
        network: "testnet",
        networkPassphrase: "Test SDF Network",
        ledgerSequence: 1000,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        generatedBy: "retriever-test",
        toolVersion: "1.0.0",
        sizeBytes: 0,
      },
      content: { test: "content" },
    };

    await storageService.storeArtifact(artifact);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it("should retrieve artifact", async () => {
    const artifact = await retriever.getArtifact(
      "CONTRACT-RETR",
      "retriever-test",
    );

    expect(artifact).not.toBeNull();
    expect(artifact!.metadata.artifactId).toBe("retriever-test");
  });

  it("should cache retrieved artifacts", async () => {
    await retriever.getArtifact("CONTRACT-RETR", "retriever-test");

    const stats = retriever.getCacheStats();
    expect(stats.size).toBe(1);
  });

  it("should check artifact existence", async () => {
    const exists = await retriever.artifactExists(
      "CONTRACT-RETR",
      "retriever-test",
    );

    expect(exists).toBe(true);
  });

  it("should return null for non-existent artifact", async () => {
    const artifact = await retriever.getArtifact(
      "CONTRACT-RETR",
      "non-existent",
    );

    expect(artifact).toBeNull();
  });
});

describe("MetadataManager", () => {
  let tempDir: string;
  let metadataManager: MetadataManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "metadata-manager-"),
    );
    metadataManager = new MetadataManager(tempDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it("should register artifact metadata", () => {
    const metadata: ArtifactMetadata = {
      artifactId: "metadata-test",
      contractId: "CONTRACT-META",
      artifactType: "report",
      format: "json",
      network: "testnet",
      networkPassphrase: "Test SDF Network",
      ledgerSequence: 1000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      generatedBy: "metadata-test",
      toolVersion: "1.0.0",
      sizeBytes: 100,
    };

    metadataManager.registerArtifact(metadata);

    const retrieved = metadataManager.getContractMetadata(
      "CONTRACT-META",
    );
    expect(retrieved).toHaveLength(1);
  });

  it("should get metadata by type", () => {
    const metadata: ArtifactMetadata = {
      artifactId: "type-test",
      contractId: "CONTRACT-TYPE",
      artifactType: "analysis",
      format: "json",
      network: "testnet",
      networkPassphrase: "Test SDF Network",
      ledgerSequence: 1000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      generatedBy: "type-test",
      toolVersion: "1.0.0",
      sizeBytes: 100,
    };

    metadataManager.registerArtifact(metadata);

    const results = metadataManager.getMetadataByType("analysis");
    expect(results).toHaveLength(1);
    expect(results[0].artifactType).toBe("analysis");
  });
});
