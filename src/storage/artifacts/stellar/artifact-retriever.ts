/**
 * Soroban Analysis Artifact Retrieval Utilities
 *
 * Helper utilities for retrieving, searching, and accessing stored artifacts
 * with convenient query interfaces and caching support.
 */

import {
  Artifact,
  ArtifactMetadata,
  ArtifactQuery,
  RetrieveArtifactOptions,
} from "./types";
import ArtifactStorageService from "./artifact-storage.service";

/**
 * Artifact retrieval cache entry
 */
interface CacheEntry {
  artifact: Artifact;
  timestamp: number;
}

/**
 * Configuration for artifact retrieval
 */
export interface ArtifactRetrievalConfig {
  /** Enable caching of retrieved artifacts */
  enableCache?: boolean;
  /** Cache TTL in milliseconds */
  cacheTtlMs?: number;
  /** Maximum number of items in cache */
  maxCacheSize?: number;
}

/**
 * High-level artifact retrieval interface
 */
export class ArtifactRetriever {
  private storageService: ArtifactStorageService;
  private cache: Map<string, CacheEntry> = new Map();
  private config: Required<ArtifactRetrievalConfig>;

  constructor(
    storageService: ArtifactStorageService,
    config: ArtifactRetrievalConfig = {},
  ) {
    this.storageService = storageService;
    this.config = {
      enableCache: config.enableCache ?? true,
      cacheTtlMs: config.cacheTtlMs ?? 5 * 60 * 1000, // 5 minutes default
      maxCacheSize: config.maxCacheSize ?? 100,
    };
  }

  /**
   * Retrieve artifact by ID
   */
  async getArtifact(
    contractId: string,
    artifactId: string,
    options: RetrieveArtifactOptions = {},
  ): Promise<Artifact | null> {
    const cacheKey = `${contractId}:${artifactId}`;

    // Check cache
    if (this.config.enableCache) {
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        return cached;
      }
    }

    // Retrieve from storage
    const artifact = await this.storageService.retrieveArtifact(
      contractId,
      artifactId,
      options,
    );

    // Cache result
    if (artifact && this.config.enableCache) {
      this.addToCache(cacheKey, artifact);
    }

    return artifact;
  }

  /**
   * Get latest artifact of a specific type for a contract
   */
  async getLatestArtifact(
    contractId: string,
    artifactType: ArtifactMetadata["artifactType"],
    options: RetrieveArtifactOptions = {},
  ): Promise<Artifact | null> {
    const query: ArtifactQuery = {
      contractId,
      artifactType,
      limit: 1,
      sortBy: "createdAt",
      sortOrder: "desc",
    };

    const results = await this.storageService.queryArtifacts(query);

    if (results.length === 0) {
      return null;
    }

    return this.getArtifact(
      contractId,
      results[0].artifactId,
      options,
    );
  }

  /**
   * Get multiple artifacts by type
   */
  async getArtifactsByType(
    contractId: string,
    artifactType: ArtifactMetadata["artifactType"],
    limit: number = 10,
  ): Promise<Artifact[]> {
    const query: ArtifactQuery = {
      contractId,
      artifactType,
      limit,
      sortBy: "createdAt",
      sortOrder: "desc",
    };

    const metadataList = await this.storageService.queryArtifacts(query);
    const artifacts: Artifact[] = [];

    for (const metadata of metadataList) {
      const artifact = await this.getArtifact(
        contractId,
        metadata.artifactId,
        { metadataOnly: false },
      );
      if (artifact) {
        artifacts.push(artifact);
      }
    }

    return artifacts;
  }

  /**
   * Get artifacts by tags
   */
  async getArtifactsByTags(
    contractId: string,
    tags: string[],
    limit: number = 10,
  ): Promise<Artifact[]> {
    const query: ArtifactQuery = {
      contractId,
      tags,
      limit,
      sortBy: "createdAt",
      sortOrder: "desc",
    };

    const metadataList = await this.storageService.queryArtifacts(query);
    const artifacts: Artifact[] = [];

    for (const metadata of metadataList) {
      const artifact = await this.getArtifact(
        contractId,
        metadata.artifactId,
        { metadataOnly: false },
      );
      if (artifact) {
        artifacts.push(artifact);
      }
    }

    return artifacts;
  }

  /**
   * Get only metadata without content
   */
  async getArtifactMetadata(
    contractId: string,
    artifactId: string,
  ): Promise<ArtifactMetadata | null> {
    const artifact = await this.getArtifact(
      contractId,
      artifactId,
      { metadataOnly: true },
    );
    return artifact ? artifact.metadata : null;
  }

  /**
   * Get artifact content only
   */
  async getArtifactContent(
    contractId: string,
    artifactId: string,
  ): Promise<string | Record<string, unknown> | null> {
    const artifact = await this.getArtifact(contractId, artifactId);
    return artifact ? artifact.content : null;
  }

  /**
   * Search artifacts with complex query
   */
  async searchArtifacts(
    query: ArtifactQuery,
  ): Promise<ArtifactMetadata[]> {
    return this.storageService.queryArtifacts(query);
  }

  /**
   * Get all artifacts for a contract
   */
  async getContractArtifacts(
    contractId: string,
    limit: number = 50,
  ): Promise<ArtifactMetadata[]> {
    const query: ArtifactQuery = {
      contractId,
      limit,
      sortBy: "createdAt",
      sortOrder: "desc",
    };

    return this.storageService.queryArtifacts(query);
  }

  /**
   * Check if artifact exists
   */
  async artifactExists(
    contractId: string,
    artifactId: string,
  ): Promise<boolean> {
    const artifact = await this.getArtifact(
      contractId,
      artifactId,
      { metadataOnly: true },
    );
    return artifact !== null;
  }

  /**
   * Get artifact creation and modification times
   */
  async getArtifactTimestamps(
    contractId: string,
    artifactId: string,
  ): Promise<{ createdAt: number; updatedAt: number } | null> {
    const metadata = await this.getArtifactMetadata(
      contractId,
      artifactId,
    );
    return metadata
      ? { createdAt: metadata.createdAt, updatedAt: metadata.updatedAt }
      : null;
  }

  /**
   * Get artifacts created within a date range
   */
  async getArtifactsInDateRange(
    contractId: string,
    startTime: number,
    endTime: number,
  ): Promise<ArtifactMetadata[]> {
    const query: ArtifactQuery = {
      contractId,
      createdAfter: startTime,
      createdBefore: endTime,
      sortBy: "createdAt",
      sortOrder: "desc",
    };

    return this.storageService.queryArtifacts(query);
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    maxSize: number;
    utilized: number;
  } {
    return {
      size: this.cache.size,
      maxSize: this.config.maxCacheSize,
      utilized: (this.cache.size / this.config.maxCacheSize) * 100,
    };
  }

  /**
   * Get from cache with TTL check
   */
  private getFromCache(key: string): Artifact | null {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if entry has expired
    if (Date.now() - entry.timestamp > this.config.cacheTtlMs) {
      this.cache.delete(key);
      return null;
    }

    return entry.artifact;
  }

  /**
   * Add to cache with size management
   */
  private addToCache(key: string, artifact: Artifact): void {
    // Enforce max cache size
    if (this.cache.size >= this.config.maxCacheSize) {
      // Remove oldest entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      artifact,
      timestamp: Date.now(),
    });
  }
}

export default ArtifactRetriever;
