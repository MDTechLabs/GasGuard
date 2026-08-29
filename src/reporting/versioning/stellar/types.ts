/**
 * Soroban Analysis Report Versioning Types
 *
 * Type definitions for version management of generated analysis reports,
 * supporting revision history, diffing, and snapshot preservation.
 */

/**
 * Represents a single versioned snapshot of an analysis report.
 */
export interface ReportVersion {
  /** Unique version identifier (e.g., "v1", "v2") */
  id: string;

  /** Semantic version string (e.g., "1.0.0") */
  version: string;

  /** Timestamp when this version was created */
  createdAt: Date;

  /** The report data payload */
  data: Record<string, unknown>;

  /** Optional metadata about this version */
  metadata?: {
    /** Description of changes in this version */
    description?: string;

    /** Who created this version */
    author?: string;

    /** Tags associated with this version */
    tags?: string[];

    [key: string]: unknown;
  };
}

/**
 * Serialized/dump representation of a version for storage or export.
 */
export interface VersionDump {
  /** Dump format version */
  formatVersion: string;

  /** When the dump was created */
  exportedAt: Date;

  /** All versions included in this dump */
  versions: ReportVersion[];

  /** Number of versions in this dump */
  totalVersions: number;

  /** Optional metadata about this dump */
  metadata?: Record<string, unknown>;
}

/**
 * Represents a diff between two report versions.
 */
export interface VersionDiff {
  /** Source version ID */
  fromVersion: string;

  /** Target version ID */
  toVersion: string;

  /** List of added keys */
  added: string[];

  /** List of removed keys */
  removed: string[];

  /** List of modified keys with old and new values */
  modified: ModifiedEntry[];

  /** Summary of the diff */
  summary: string;

  /** Timestamp when diff was generated */
  generatedAt: Date;
}

/**
 * Entry for a modified field between versions.
 */
export interface ModifiedEntry {
  /** Key path that was modified */
  key: string;

  /** Previous value */
  oldValue: unknown;

  /** New value */
  newValue: unknown;
}
