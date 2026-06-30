/**
 * Soroban Analysis Artifact Storage Types
 *
 * Type definitions for persisting generated analysis artifacts including
 * reports, metadata, and other analysis outputs for Soroban contracts.
 */

/**
 * Artifact metadata for tracking and retrieval
 */
export interface ArtifactMetadata {
  /** Unique artifact identifier */
  artifactId: string;
  /** Contract ID/address that generated this artifact */
  contractId: string;
  /** Type of artifact (report, snapshot, analysis, etc.) */
  artifactType:
    | "report"
    | "snapshot"
    | "analysis"
    | "metrics"
    | "recommendations"
    | "security_audit"
    | "performance_profile";
  /** Format of the artifact (json, markdown, html, etc.) */
  format: "json" | "markdown" | "html" | "csv" | "binary";
  /** Contract version analyzed */
  contractVersion?: string;
  /** Network on which contract was analyzed */
  network: "testnet" | "mainnet" | "standalone";
  /** Network passphrase */
  networkPassphrase: string;
  /** Ledger sequence at time of analysis */
  ledgerSequence: number;
  /** Timestamp when artifact was created */
  createdAt: number;
  /** Timestamp when artifact was last updated */
  updatedAt: number;
  /** Optional description or notes about the artifact */
  description?: string;
  /** Tags for organizing and searching artifacts */
  tags?: string[];
  /** Originating analysis tool or module */
  generatedBy: string;
  /** Tool/module version that generated the artifact */
  toolVersion: string;
  /** Size in bytes */
  sizeBytes: number;
  /** Checksum for integrity verification */
  checksum?: string;
  /** Expiration timestamp (optional, for temporary artifacts) */
  expiresAt?: number;
  /** Related artifact IDs (dependencies or related outputs) */
  relatedArtifacts?: string[];
}

/**
 * Artifact content with metadata
 */
export interface Artifact {
  /** Artifact metadata */
  metadata: ArtifactMetadata;
  /** Artifact content (can be string or object depending on format) */
  content: string | Record<string, unknown>;
}

/**
 * Query parameters for retrieving artifacts
 */
export interface ArtifactQuery {
  /** Filter by artifact ID */
  artifactId?: string;
  /** Filter by contract ID */
  contractId?: string;
  /** Filter by artifact type */
  artifactType?: ArtifactMetadata["artifactType"];
  /** Filter by network */
  network?: ArtifactMetadata["network"];
  /** Filter by tags (matches if artifact has any of these tags) */
  tags?: string[];
  /** Filter by creation date range (timestamps in ms) */
  createdAfter?: number;
  createdBefore?: number;
  /** Filter by tool that generated it */
  generatedBy?: string;
  /** Maximum number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Sort by field */
  sortBy?: "createdAt" | "updatedAt" | "sizeBytes";
  /** Sort order */
  sortOrder?: "asc" | "desc";
}

/**
 * Result from artifact storage operations
 */
export interface StorageResult {
  /** Operation successful */
  success: boolean;
  /** Artifact ID (if applicable) */
  artifactId?: string;
  /** File path where artifact was stored */
  filePath?: string;
  /** Error message if operation failed */
  error?: string;
  /** Additional metadata or details */
  details?: Record<string, unknown>;
}

/**
 * Batch operation result
 */
export interface BatchStorageResult {
  /** Total items in batch */
  total: number;
  /** Successfully stored items */
  succeeded: number;
  /** Failed items */
  failed: number;
  /** Results for each item */
  results: StorageResult[];
}

/**
 * Configuration for artifact storage
 */
export interface ArtifactStorageConfig {
  /** Base directory for storing artifacts */
  baseDir: string;
  /** Whether to enable compression for large artifacts */
  enableCompression: boolean;
  /** Maximum artifact size in bytes (0 = unlimited) */
  maxSizeBytes: number;
  /** Retention policy - time in ms before automatic deletion (0 = keep forever) */
  retentionMs: number;
  /** Whether to verify checksum on retrieval */
  verifyChecksum: boolean;
  /** Whether to create backup copies */
  createBackups: boolean;
  /** Backup directory */
  backupDir?: string;
}

/**
 * Statistics about stored artifacts
 */
export interface StorageStatistics {
  /** Total number of artifacts */
  totalArtifacts: number;
  /** Total size of all artifacts in bytes */
  totalSizeBytes: number;
  /** Average artifact size in bytes */
  averageSizeBytes: number;
  /** Breakdown by artifact type */
  byType: Record<ArtifactMetadata["artifactType"], number>;
  /** Breakdown by network */
  byNetwork: Record<ArtifactMetadata["network"], number>;
  /** Breakdown by format */
  byFormat: Record<ArtifactMetadata["format"], number>;
  /** Oldest artifact timestamp */
  oldestArtifactAt?: number;
  /** Most recent artifact timestamp */
  newestArtifactAt?: number;
}

/**
 * Options for storing artifacts
 */
export interface StoreArtifactOptions {
  /** Whether to overwrite existing artifact with same ID */
  overwrite?: boolean;
  /** Whether to compress the artifact */
  compress?: boolean;
  /** Whether to create a backup of replaced artifact */
  backup?: boolean;
  /** Custom retention time in ms (overrides default) */
  retentionMs?: number;
}

/**
 * Options for retrieving artifacts
 */
export interface RetrieveArtifactOptions {
  /** Whether to decompress if compressed */
  decompress?: boolean;
  /** Whether to verify checksum */
  verifyChecksum?: boolean;
  /** Return only metadata without content */
  metadataOnly?: boolean;
}
