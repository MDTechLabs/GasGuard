/**
 * Soroban Analysis Artifact Storage Service
 *
 * Handles persistence of generated analysis artifacts including reports,
 * snapshots, and metadata. Supports storing, retrieving, and managing artifacts.
 */

import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import {
  Artifact,
  ArtifactMetadata,
  ArtifactQuery,
  StorageResult,
  BatchStorageResult,
  ArtifactStorageConfig,
  StorageStatistics,
  StoreArtifactOptions,
  RetrieveArtifactOptions,
} from "./types";

/**
 * Service for storing and retrieving Soroban analysis artifacts
 */
export class ArtifactStorageService {
  private config: ArtifactStorageConfig;
  private metadataFile: string;

  constructor(config: Partial<ArtifactStorageConfig> = {}) {
    this.config = {
      baseDir: config.baseDir || "./artifacts",
      enableCompression: config.enableCompression ?? false,
      maxSizeBytes: config.maxSizeBytes ?? 0,
      retentionMs: config.retentionMs ?? 0,
      verifyChecksum: config.verifyChecksum ?? true,
      createBackups: config.createBackups ?? true,
      backupDir: config.backupDir || "./artifacts/backups",
    };

    this.metadataFile = path.join(this.config.baseDir, ".metadata.json");

    // Initialize storage directory
    this.initializeStorage();
  }

  /**
   * Initialize storage directories
   */
  private initializeStorage(): void {
    try {
      if (!fs.existsSync(this.config.baseDir)) {
        fs.mkdirSync(this.config.baseDir, { recursive: true });
      }
      if (
        this.config.createBackups &&
        !fs.existsSync(this.config.backupDir!)
      ) {
        fs.mkdirSync(this.config.backupDir!, { recursive: true });
      }
    } catch (error) {
      throw new Error(`Failed to initialize storage: ${error}`);
    }
  }

  /**
   * Store an artifact with metadata
   */
  async storeArtifact(
    artifact: Artifact,
    options: StoreArtifactOptions = {},
  ): Promise<StorageResult> {
    try {
      const { artifactId, contractId } = artifact.metadata;

      // Check if artifact already exists
      const artifactDir = path.join(
        this.config.baseDir,
        this.getArtifactPath(contractId, artifactId),
      );
      const artifactPath = path.join(artifactDir, "artifact");

      if (fs.existsSync(artifactPath) && !options.overwrite) {
        return {
          success: false,
          error: `Artifact ${artifactId} already exists. Use overwrite: true to replace.`,
        };
      }

      // Handle backup of existing artifact
      if (fs.existsSync(artifactPath) && options.backup && this.config.createBackups) {
        this.backupArtifact(contractId, artifactId);
      }

      // Create artifact directory
      fs.mkdirSync(artifactDir, { recursive: true });

      // Serialize content
      const contentString =
        typeof artifact.content === "string"
          ? artifact.content
          : JSON.stringify(artifact.content, null, 2);

      // Check size constraint
      const contentSize = Buffer.byteLength(contentString, "utf8");
      if (
        this.config.maxSizeBytes > 0 &&
        contentSize > this.config.maxSizeBytes
      ) {
        return {
          success: false,
          error: `Artifact exceeds maximum size of ${this.config.maxSizeBytes} bytes (${contentSize} bytes)`,
        };
      }

      // Calculate checksum
      const checksum = createHash("sha256").update(contentString).digest("hex");

      // Update metadata
      artifact.metadata.sizeBytes = contentSize;
      artifact.metadata.checksum = checksum;
      artifact.metadata.updatedAt = Date.now();

      // Store artifact content
      fs.writeFileSync(artifactPath, contentString, "utf8");

      // Store metadata
      const metadataPath = path.join(artifactDir, "metadata.json");
      fs.writeFileSync(
        metadataPath,
        JSON.stringify(artifact.metadata, null, 2),
        "utf8",
      );

      // Update central metadata index
      this.updateMetadataIndex(artifact.metadata);

      return {
        success: true,
        artifactId,
        filePath: artifactPath,
        details: {
          sizeBytes: contentSize,
          checksum,
          backupCreated: fs.existsSync(artifactPath) && options.backup,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to store artifact: ${error}`,
      };
    }
  }

  /**
   * Retrieve an artifact
   */
  async retrieveArtifact(
    contractId: string,
    artifactId: string,
    options: RetrieveArtifactOptions = {},
  ): Promise<Artifact | null> {
    try {
      const artifactDir = path.join(
        this.config.baseDir,
        this.getArtifactPath(contractId, artifactId),
      );
      const artifactPath = path.join(artifactDir, "artifact");
      const metadataPath = path.join(artifactDir, "metadata.json");

      // Check if artifact exists
      if (!fs.existsSync(artifactPath) || !fs.existsSync(metadataPath)) {
        return null;
      }

      // Load metadata
      const metadataContent = fs.readFileSync(metadataPath, "utf8");
      const metadata: ArtifactMetadata = JSON.parse(metadataContent);

      // If metadata only requested, return early
      if (options.metadataOnly) {
        return {
          metadata,
          content: "",
        };
      }

      // Load artifact content
      let content = fs.readFileSync(artifactPath, "utf8");

      // Verify checksum if configured
      if (options.verifyChecksum && metadata.checksum) {
        const actualChecksum = createHash("sha256")
          .update(content)
          .digest("hex");
        if (actualChecksum !== metadata.checksum) {
          throw new Error("Artifact checksum verification failed");
        }
      }

      // Try to parse JSON content if applicable
      let parsedContent: string | Record<string, unknown> = content;
      if (metadata.format === "json") {
        try {
          parsedContent = JSON.parse(content);
        } catch {
          // Keep as string if JSON parsing fails
        }
      }

      return {
        metadata,
        content: parsedContent,
      };
    } catch (error) {
      throw new Error(`Failed to retrieve artifact: ${error}`);
    }
  }

  /**
   * Query artifacts by metadata criteria
   */
  async queryArtifacts(query: ArtifactQuery): Promise<ArtifactMetadata[]> {
    try {
      const allMetadata = this.loadAllMetadata();

      // Apply filters
      let results = allMetadata.filter((m) => {
        if (query.artifactId && m.artifactId !== query.artifactId) return false;
        if (query.contractId && m.contractId !== query.contractId) return false;
        if (query.artifactType && m.artifactType !== query.artifactType)
          return false;
        if (query.network && m.network !== query.network) return false;
        if (query.generatedBy && m.generatedBy !== query.generatedBy)
          return false;

        if (query.createdAfter && m.createdAt < query.createdAfter)
          return false;
        if (query.createdBefore && m.createdAt > query.createdBefore)
          return false;

        if (query.tags && query.tags.length > 0) {
          const hasMatchingTag =
            m.tags &&
            m.tags.some((tag) => query.tags!.includes(tag));
          if (!hasMatchingTag) return false;
        }

        return true;
      });

      // Sort results
      if (query.sortBy) {
        const multiplier = query.sortOrder === "desc" ? -1 : 1;
        results.sort((a, b) => {
          const aValue = a[query.sortBy as keyof ArtifactMetadata];
          const bValue = b[query.sortBy as keyof ArtifactMetadata];

          if (typeof aValue === "number" && typeof bValue === "number") {
            return (aValue - bValue) * multiplier;
          }
          return 0;
        });
      }

      // Apply pagination
      if (query.limit) {
        const offset = query.offset || 0;
        results = results.slice(offset, offset + query.limit);
      }

      return results;
    } catch (error) {
      throw new Error(`Failed to query artifacts: ${error}`);
    }
  }

  /**
   * Store multiple artifacts
   */
  async storeArtifactBatch(
    artifacts: Artifact[],
    options: StoreArtifactOptions = {},
  ): Promise<BatchStorageResult> {
    const results: StorageResult[] = [];

    for (const artifact of artifacts) {
      const result = await this.storeArtifact(artifact, options);
      results.push(result);
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return {
      total: artifacts.length,
      succeeded,
      failed,
      results,
    };
  }

  /**
   * Delete an artifact
   */
  async deleteArtifact(
    contractId: string,
    artifactId: string,
  ): Promise<StorageResult> {
    try {
      const artifactDir = path.join(
        this.config.baseDir,
        this.getArtifactPath(contractId, artifactId),
      );

      if (!fs.existsSync(artifactDir)) {
        return {
          success: false,
          error: `Artifact ${artifactId} not found`,
        };
      }

      // Remove directory and contents
      fs.rmSync(artifactDir, { recursive: true, force: true });

      return {
        success: true,
        artifactId,
        details: { deleted: true },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to delete artifact: ${error}`,
      };
    }
  }

  /**
   * Clean up expired artifacts
   */
  async cleanupExpiredArtifacts(): Promise<BatchStorageResult> {
    const now = Date.now();
    const expiredMetadata = this.loadAllMetadata().filter((m) => {
      if (!m.expiresAt) return false;
      return m.expiresAt <= now;
    });

    const results: StorageResult[] = [];

    for (const metadata of expiredMetadata) {
      const result = await this.deleteArtifact(
        metadata.contractId,
        metadata.artifactId,
      );
      results.push(result);
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return {
      total: expiredMetadata.length,
      succeeded,
      failed,
      results,
    };
  }

  /**
   * Get storage statistics
   */
  getStorageStatistics(): StorageStatistics {
    const allMetadata = this.loadAllMetadata();

    if (allMetadata.length === 0) {
      return {
        totalArtifacts: 0,
        totalSizeBytes: 0,
        averageSizeBytes: 0,
        byType: {
          report: 0,
          snapshot: 0,
          analysis: 0,
          metrics: 0,
          recommendations: 0,
          security_audit: 0,
          performance_profile: 0,
        },
        byNetwork: {
          testnet: 0,
          mainnet: 0,
          standalone: 0,
        },
        byFormat: {
          json: 0,
          markdown: 0,
          html: 0,
          csv: 0,
          binary: 0,
        },
      };
    }

    const stats: StorageStatistics = {
      totalArtifacts: allMetadata.length,
      totalSizeBytes: 0,
      averageSizeBytes: 0,
      byType: {
        report: 0,
        snapshot: 0,
        analysis: 0,
        metrics: 0,
        recommendations: 0,
        security_audit: 0,
        performance_profile: 0,
      },
      byNetwork: {
        testnet: 0,
        mainnet: 0,
        standalone: 0,
      },
      byFormat: {
        json: 0,
        markdown: 0,
        html: 0,
        csv: 0,
        binary: 0,
      },
      oldestArtifactAt: Math.min(...allMetadata.map((m) => m.createdAt)),
      newestArtifactAt: Math.max(...allMetadata.map((m) => m.createdAt)),
    };

    for (const metadata of allMetadata) {
      stats.totalSizeBytes += metadata.sizeBytes;
      stats.byType[metadata.artifactType]++;
      stats.byNetwork[metadata.network]++;
      stats.byFormat[metadata.format]++;
    }

    stats.averageSizeBytes =
      stats.totalSizeBytes / stats.totalArtifacts;

    return stats;
  }

  /**
   * Generate artifact path based on contract and artifact ID
   */
  private getArtifactPath(contractId: string, artifactId: string): string {
    const datePart = new Date(Date.now()).toISOString().split("T")[0];
    return path.join(contractId, datePart, artifactId);
  }

  /**
   * Backup an existing artifact
   */
  private backupArtifact(contractId: string, artifactId: string): void {
    try {
      const sourcePath = path.join(
        this.config.baseDir,
        this.getArtifactPath(contractId, artifactId),
      );
      const backupTimestamp = Date.now();
      const backupPath = path.join(
        this.config.backupDir!,
        contractId,
        `${artifactId}-${backupTimestamp}`,
      );

      fs.mkdirSync(path.dirname(backupPath), { recursive: true });

      // Copy the entire artifact directory
      this.copyDirectory(sourcePath, backupPath);
    } catch (error) {
      console.warn(`Failed to backup artifact: ${error}`);
    }
  }

  /**
   * Copy directory recursively
   */
  private copyDirectory(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    const files = fs.readdirSync(src);

    for (const file of files) {
      const srcFile = path.join(src, file);
      const destFile = path.join(dest, file);

      if (fs.statSync(srcFile).isDirectory()) {
        this.copyDirectory(srcFile, destFile);
      } else {
        fs.copyFileSync(srcFile, destFile);
      }
    }
  }

  /**
   * Load all artifact metadata
   */
  private loadAllMetadata(): ArtifactMetadata[] {
    try {
      if (!fs.existsSync(this.metadataFile)) {
        return [];
      }

      const content = fs.readFileSync(this.metadataFile, "utf8");
      return JSON.parse(content);
    } catch (error) {
      console.warn(`Failed to load metadata index: ${error}`);
      return [];
    }
  }

  /**
   * Update metadata index
   */
  private updateMetadataIndex(metadata: ArtifactMetadata): void {
    try {
      let allMetadata = this.loadAllMetadata();

      // Remove existing entry if present
      allMetadata = allMetadata.filter(
        (m) =>
          !(
            m.artifactId === metadata.artifactId &&
            m.contractId === metadata.contractId
          ),
      );

      // Add new entry
      allMetadata.push(metadata);

      // Save updated metadata
      fs.writeFileSync(
        this.metadataFile,
        JSON.stringify(allMetadata, null, 2),
        "utf8",
      );
    } catch (error) {
      console.warn(`Failed to update metadata index: ${error}`);
    }
  }
}

export default ArtifactStorageService;
