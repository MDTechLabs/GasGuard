/**
 * Soroban Analysis Artifact Metadata Manager
 *
 * Handles metadata indexing, searching, and management for stored artifacts.
 * Provides efficient metadata queries and bulk operations.
 */

import * as fs from "fs";
import * as path from "path";
import { ArtifactMetadata, ArtifactQuery, StorageStatistics } from "./types";

/**
 * Index entry for fast lookups
 */
interface IndexEntry {
  artifactId: string;
  contractId: string;
  createdAt: number;
  artifactType: ArtifactMetadata["artifactType"];
  network: ArtifactMetadata["network"];
}

/**
 * Manager for artifact metadata and indexing
 */
export class MetadataManager {
  private indexPath: string;
  private metadataDir: string;
  private index: Map<string, IndexEntry> = new Map();

  constructor(baseDir: string = "./artifacts") {
    this.metadataDir = baseDir;
    this.indexPath = path.join(baseDir, ".index.json");
    this.loadIndex();
  }

  /**
   * Register new artifact metadata
   */
  registerArtifact(metadata: ArtifactMetadata): void {
    const key = this.getMetadataKey(
      metadata.contractId,
      metadata.artifactId,
    );

    this.index.set(key, {
      artifactId: metadata.artifactId,
      contractId: metadata.contractId,
      createdAt: metadata.createdAt,
      artifactType: metadata.artifactType,
      network: metadata.network,
    });

    this.saveIndex();
  }

  /**
   * Unregister artifact metadata
   */
  unregisterArtifact(contractId: string, artifactId: string): void {
    const key = this.getMetadataKey(contractId, artifactId);
    this.index.delete(key);
    this.saveIndex();
  }

  /**
   * Get metadata for artifact
   */
  getMetadata(
    contractId: string,
    artifactId: string,
  ): ArtifactMetadata | null {
    const metadataPath = this.getMetadataPath(contractId, artifactId);

    try {
      if (fs.existsSync(metadataPath)) {
        const content = fs.readFileSync(metadataPath, "utf8");
        return JSON.parse(content);
      }
    } catch (error) {
      console.warn(
        `Failed to load metadata from ${metadataPath}: ${error}`,
      );
    }

    return null;
  }

  /**
   * Update metadata for artifact
   */
  updateMetadata(metadata: ArtifactMetadata): void {
    const metadataPath = this.getMetadataPath(
      metadata.contractId,
      metadata.artifactId,
    );

    try {
      const dir = path.dirname(metadataPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        metadataPath,
        JSON.stringify(metadata, null, 2),
        "utf8",
      );
      this.registerArtifact(metadata);
    } catch (error) {
      throw new Error(`Failed to update metadata: ${error}`);
    }
  }

  /**
   * Find metadata by criteria
   */
  findByCriteria(query: Partial<ArtifactQuery>): ArtifactMetadata[] {
    const results: ArtifactMetadata[] = [];

    for (const entry of this.index.values()) {
      let matches = true;

      if (
        query.contractId &&
        entry.contractId !== query.contractId
      ) {
        matches = false;
      }
      if (
        query.artifactType &&
        entry.artifactType !== query.artifactType
      ) {
        matches = false;
      }
      if (query.network && entry.network !== query.network) {
        matches = false;
      }

      if (
        query.createdAfter &&
        entry.createdAt < query.createdAfter
      ) {
        matches = false;
      }
      if (
        query.createdBefore &&
        entry.createdAt > query.createdBefore
      ) {
        matches = false;
      }

      if (matches) {
        const metadata = this.getMetadata(
          entry.contractId,
          entry.artifactId,
        );
        if (metadata) {
          results.push(metadata);
        }
      }
    }

    return results;
  }

  /**
   * Get all metadata for contract
   */
  getContractMetadata(contractId: string): ArtifactMetadata[] {
    return this.findByCriteria({ contractId });
  }

  /**
   * Get metadata by type
   */
  getMetadataByType(
    artifactType: ArtifactMetadata["artifactType"],
  ): ArtifactMetadata[] {
    return this.findByCriteria({ artifactType });
  }

  /**
   * Get metadata by network
   */
  getMetadataByNetwork(
    network: ArtifactMetadata["network"],
  ): ArtifactMetadata[] {
    return this.findByCriteria({ network });
  }

  /**
   * Get metadata by tags
   */
  getMetadataByTags(tags: string[]): ArtifactMetadata[] {
    const allMetadata = Array.from(this.index.values()).map((entry) =>
      this.getMetadata(entry.contractId, entry.artifactId),
    );

    return allMetadata.filter((m) => {
      if (!m || !m.tags) return false;
      return tags.some((tag) => m.tags!.includes(tag));
    }) as ArtifactMetadata[];
  }

  /**
   * Get most recent artifacts
   */
  getMostRecentArtifacts(limit: number = 10): ArtifactMetadata[] {
    const allMetadata = Array.from(this.index.values())
      .map((entry) => this.getMetadata(entry.contractId, entry.artifactId))
      .filter((m) => m !== null) as ArtifactMetadata[];

    return allMetadata
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  /**
   * Get artifacts by date range
   */
  getArtifactsByDateRange(
    startTime: number,
    endTime: number,
  ): ArtifactMetadata[] {
    return this.findByCriteria({
      createdAfter: startTime,
      createdBefore: endTime,
    });
  }

  /**
   * Get statistics about stored metadata
   */
  getStatistics(): StorageStatistics {
    const allMetadata = Array.from(this.index.values())
      .map((entry) => this.getMetadata(entry.contractId, entry.artifactId))
      .filter((m) => m !== null) as ArtifactMetadata[];

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
      oldestArtifactAt: Math.min(
        ...allMetadata.map((m) => m.createdAt),
      ),
      newestArtifactAt: Math.max(
        ...allMetadata.map((m) => m.createdAt),
      ),
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
   * Rebuild index from disk
   */
  rebuildIndex(): void {
    this.index.clear();

    try {
      const entries = this.scanDirectory(this.metadataDir);
      for (const entry of entries) {
        const metadata = this.getMetadata(
          entry.contractId,
          entry.artifactId,
        );
        if (metadata) {
          this.registerArtifact(metadata);
        }
      }
    } catch (error) {
      console.warn(`Failed to rebuild index: ${error}`);
    }
  }

  /**
   * Clean up orphaned metadata files
   */
  cleanupOrphanedMetadata(): number {
    const entries = this.scanDirectory(this.metadataDir);
    let removed = 0;

    for (const entry of entries) {
      const key = this.getMetadataKey(
        entry.contractId,
        entry.artifactId,
      );

      if (!this.index.has(key)) {
        try {
          const metadataPath = this.getMetadataPath(
            entry.contractId,
            entry.artifactId,
          );
          fs.unlinkSync(metadataPath);
          removed++;
        } catch (error) {
          console.warn(
            `Failed to remove orphaned metadata: ${error}`,
          );
        }
      }
    }

    return removed;
  }

  /**
   * Get metadata file path
   */
  private getMetadataPath(
    contractId: string,
    artifactId: string,
  ): string {
    const datePart = new Date(Date.now()).toISOString().split("T")[0];
    return path.join(
      this.metadataDir,
      contractId,
      datePart,
      artifactId,
      "metadata.json",
    );
  }

  /**
   * Get metadata cache key
   */
  private getMetadataKey(contractId: string, artifactId: string): string {
    return `${contractId}:${artifactId}`;
  }

  /**
   * Scan directory for metadata files
   */
  private scanDirectory(dir: string): IndexEntry[] {
    const entries: IndexEntry[] = [];

    try {
      if (!fs.existsSync(dir)) {
        return entries;
      }

      const walk = (currentPath: string, depth: number = 0) => {
        if (depth > 5) return; // Limit recursion

        try {
          const files = fs.readdirSync(currentPath);

          for (const file of files) {
            if (file === ".metadata.json" || file === ".index.json") {
              continue;
            }

            const filePath = path.join(currentPath, file);
            const stat = fs.statSync(filePath);

            if (stat.isDirectory()) {
              walk(filePath, depth + 1);
            } else if (file === "metadata.json") {
              // Extract contract and artifact IDs from path
              const parts = filePath
                .replace(dir, "")
                .split(path.sep)
                .filter((p) => p);

              if (parts.length >= 3) {
                const contractId = parts[0];
                const artifactId = parts[2];

                const metadata = this.getMetadata(
                  contractId,
                  artifactId,
                );
                if (metadata) {
                  entries.push({
                    artifactId,
                    contractId,
                    createdAt: metadata.createdAt,
                    artifactType: metadata.artifactType,
                    network: metadata.network,
                  });
                }
              }
            }
          }
        } catch (error) {
          console.warn(
            `Error scanning directory ${currentPath}: ${error}`,
          );
        }
      };

      walk(dir);
    } catch (error) {
      console.warn(`Failed to scan directory: ${error}`);
    }

    return entries;
  }

  /**
   * Load index from disk
   */
  private loadIndex(): void {
    try {
      if (fs.existsSync(this.indexPath)) {
        const content = fs.readFileSync(this.indexPath, "utf8");
        const indexData: IndexEntry[] = JSON.parse(content);

        for (const entry of indexData) {
          const key = this.getMetadataKey(
            entry.contractId,
            entry.artifactId,
          );
          this.index.set(key, entry);
        }
      }
    } catch (error) {
      console.warn(`Failed to load index: ${error}`);
    }
  }

  /**
   * Save index to disk
   */
  private saveIndex(): void {
    try {
      const dir = path.dirname(this.indexPath);
      fs.mkdirSync(dir, { recursive: true });

      const indexData = Array.from(this.index.values());
      fs.writeFileSync(
        this.indexPath,
        JSON.stringify(indexData, null, 2),
        "utf8",
      );
    } catch (error) {
      console.warn(`Failed to save index: ${error}`);
    }
  }
}

export default MetadataManager;
