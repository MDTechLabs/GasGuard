/**
 * Soroban Analysis Artifact Storage Module
 *
 * Main entry point for artifact storage and retrieval functionality.
 * Provides all necessary components for persisting and managing Soroban
 * analysis artifacts.
 */

export * from "./types";
export { default as ArtifactStorageService } from "./artifact-storage.service";
export { default as ArtifactRetriever } from "./artifact-retriever";
export { default as MetadataManager } from "./metadata-manager";

import ArtifactStorageService from "./artifact-storage.service";
import ArtifactRetriever from "./artifact-retriever";
import MetadataManager from "./metadata-manager";

/**
 * Initialize the complete artifact storage system
 */
export function initializeArtifactStorage(baseDir: string = "./artifacts") {
  const storageService = new ArtifactStorageService({
    baseDir,
    enableCompression: false,
    maxSizeBytes: 100 * 1024 * 1024, // 100MB max
    retentionMs: 90 * 24 * 60 * 60 * 1000, // 90 days
    verifyChecksum: true,
    createBackups: true,
  });

  const retriever = new ArtifactRetriever(storageService, {
    enableCache: true,
    cacheTtlMs: 5 * 60 * 1000, // 5 minutes
    maxCacheSize: 100,
  });

  const metadataManager = new MetadataManager(baseDir);

  return {
    storageService,
    retriever,
    metadataManager,
  };
}
