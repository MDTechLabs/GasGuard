/**
 * Soroban Contract State Snapshot Types
 *
 * Type definitions for capturing and managing Soroban contract state snapshots
 * for reproducible audit and debugging purposes.
 */

/**
 * Represents a single storage entry in a Soroban contract
 */
export interface StorageEntry {
  /** Storage key (can be a symbol, address, or custom key) */
  key: string;
  /** Storage value (serialized) */
  value: string;
  /** Storage type (instance, persistent, temporary) */
  storageType: "instance" | "persistent" | "temporary";
  /** TTL expiration ledger sequence (if applicable) */
  ttlExpiration?: number;
  /** Timestamp when this entry was captured */
  capturedAt: number;
}

/**
 * Represents contract metadata in a snapshot
 */
export interface ContractMetadata {
  /** Contract ID/address */
  contractId: string;
  /** Network passphrase (e.g., 'Test SDF Network ; September 2015') */
  networkPassphrase: string;
  /** Network URL */
  networkUrl: string;
  /** Ledger sequence when snapshot was taken */
  ledgerSequence: number;
  /** Timestamp when snapshot was taken */
  timestamp: number;
  /** Contract source file path (if available) */
  sourceFilePath?: string;
  /** Contract name (if available) */
  contractName?: string;
}

/**
 * Represents a complete contract state snapshot
 */
export interface ContractStateSnapshot {
  /** Unique snapshot identifier */
  snapshotId: string;
  /** Contract metadata */
  metadata: ContractMetadata;
  /** Storage entries */
  storageEntries: StorageEntry[];
  /** Snapshot version for future compatibility */
  version: string;
  /** Optional description or notes */
  description?: string;
  /** Tags for organizing snapshots */
  tags?: string[];
}

/**
 * Configuration for snapshot export
 */
export interface SnapshotExportConfig {
  /** Include storage entries */
  includeStorage: boolean;
  /** Include metadata */
  includeMetadata: boolean;
  /** Filter storage by type */
  storageTypes?: Array<"instance" | "persistent" | "temporary">;
  /** Filter storage by key pattern */
  keyPattern?: RegExp;
  /** Max number of entries to export (for large contracts) */
  maxEntries?: number;
}

/**
 * Configuration for snapshot restoration
 */
export interface SnapshotRestoreConfig {
  /** Overwrite existing storage entries */
  overwriteExisting: boolean;
  /** Skip entries that already exist */
  skipExisting: boolean;
  /** Validate snapshot before restoration */
  validateBeforeRestore: boolean;
  /** Dry run (preview changes without applying) */
  dryRun: boolean;
}

/**
 * Result of a snapshot export operation
 */
export interface SnapshotExportResult {
  /** Success status */
  success: boolean;
  /** Exported snapshot (if successful) */
  snapshot?: ContractStateSnapshot;
  /** Error message (if failed) */
  error?: string;
  /** Number of entries exported */
  entriesExported: number;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Result of a snapshot restoration operation
 */
export interface SnapshotRestoreResult {
  /** Success status */
  success: boolean;
  /** Number of entries restored */
  entriesRestored: number;
  /** Number of entries skipped */
  entriesSkipped: number;
  /** Number of entries that failed to restore */
  entriesFailed: number;
  /** Error message (if failed) */
  error?: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** Details of failed entries (if any) */
  failedEntries?: Array<{
    key: string;
    error: string;
  }>;
}

/**
 * Snapshot validation result
 */
export interface SnapshotValidationResult {
  /** Is the snapshot valid */
  valid: boolean;
  /** Validation errors */
  errors: string[];
  /** Validation warnings */
  warnings: string[];
  /** Snapshot being validated */
  snapshot: ContractStateSnapshot;
}
