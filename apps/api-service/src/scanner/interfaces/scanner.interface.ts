export type ViolationSeverity = "error" | "warning" | "info";

export interface RuleViolation {
  ruleName: string;
  description: string;
  severity: ViolationSeverity;
  lineNumber: number;
  columnNumber: number;
  variableName: string;
  suggestion: string;
}

export interface ScanResult {
  source: string;
  violations: RuleViolation[];
  scanTime: string;
  scanDurationMs: number;
  hasViolations: boolean;
  summary: {
    total: number;
    errors: number;
    warnings: number;
    info: number;
  };
}

/**
 * Limits applied when validating an uploaded archive before it is
 * extracted or scanned. All limits are in bytes unless otherwise noted.
 */
export interface ArchiveSizeLimits {
  /** Maximum allowed size of the uploaded archive file itself. */
  maxArchiveBytes: number;
  /** Maximum allowed total size of all extracted entries. */
  maxTotalUncompressedBytes: number;
  /** Maximum allowed size of a single extracted entry. */
  maxEntryBytes: number;
  /** Maximum number of entries allowed in the archive. */
  maxEntryCount: number;
  /** Maximum allowed compression ratio (uncompressed / compressed). */
  maxCompressionRatio: number;
  /** Maximum allowed path depth for any extracted entry. */
  maxPathDepth: number;
}

export type ArchiveValidationErrorCode =
  | "ARCHIVE_TOO_LARGE"
  | "ARCHIVE_UNCOPRESSED_TOO_LARGE"
  | "ARCHIVE_ENTRY_TOO_LARGE"
  | "ARCHIVE_TOO_MANY_ENTRIES"
  | ARCHIVE_COMPRESSION_RATIO_EXCEEDED"
  | "ARCHIVE_PATH_TOO_DEEP"
  | "ARCHIVE_INVALID_FORMAT";

export interface ArchiveValidationError {
  code: ArchiveValidationErrorCode;
  message: string;
  /** The observed value that triggered the violation, when applicable. */
  observed?: number;
  /** The configured limit that was exceeded, when applicable. */
  limit?: number;
  /** The archive entry path associated with the error, when applicable. */
  entryPath?: string;
}

export interface ArchiveValidationResult {
  valid: boolean;
  errors: ArchiveValidationError[];
  /** Size of the uploaded archive in bytes. */
  archiveBytes: number;
  /** Total uncompressed size of all entries in bytes. */
  totalUncompressedBytes: number;
  /** Number of entries observed in the archive. */
  entryCount: number;
  /** Observed compression ratio, or 0 when not computable. */
  compressionRatio: number;
  /** Depth of the deepest observed entry path. */
  maxPathDepthObserved: number;
  /** Time spent validating the archive in milliseconds. */
  validationDurationMs: number;
}
