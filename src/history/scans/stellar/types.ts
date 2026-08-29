/**
 * Soroban Scan History Types
 *
 * Type definitions for storing and managing Soroban contract scan history
 * for tracking analysis results over time.
 */

import { SorobanAnalysisResult, SorobanScanDiff } from '../../../diffing/stellar/types';

/**
 * Metadata for a single Soroban contract scan
 */
export interface SorobanScanMetadata {
  /** Unique scan identifier */
  scanId: string;
  /** Timestamp when the scan was performed */
  timestamp: number;
  /** Contract name that was scanned */
  contractName: string;
  /** Contract source file path */
  filePath: string;
  /** Network passphrase (e.g., 'Test SDF Network ; September 2015') */
  networkPassphrase: string;
  /** Network URL */
  networkUrl: string;
  /** Ledger sequence at scan time */
  ledgerSequence?: number;
  /** Number of issues found in this scan */
  totalIssues: number;
  /** Breakdown by severity */
  severityBreakdown: {
    error: number;
    warning: number;
    info: number;
  };
  /** Breakdown by category */
  categoryBreakdown: Record<string, number>;
  /** Scan duration in milliseconds */
  durationMs: number;
  /** Optional description or notes */
  description?: string;
  /** Tags for organizing scans */
  tags?: string[];
  /** Scan version for compatibility */
  version: string;
}

/**
 * Complete scan record including metadata and results
 */
export interface SorobanScanRecord extends SorobanScanMetadata {
  /** Analysis results from this scan */
  results: SorobanAnalysisResult[];
}

/**
 * Filter options for querying scan history
 */
export interface SorobanScanFilter {
  /** Filter by contract name */
  contractName?: string;
  /** Filter by file path pattern */
  filePathPattern?: RegExp;
  /** Filter by network passphrase */
  networkPassphrase?: string;
  /** Filter by tags */
  tags?: string[];
  /** Filter by date range */
  dateRange?: {
    start: number;
    end: number;
  };
  /** Filter by severity (minimum level) */
  minSeverity?: 'error' | 'warning' | 'info';
  /** Filter by category */
  category?: string;
  /** Filter by ledger sequence range */
  ledgerRange?: {
    min?: number;
    max?: number;
  };
}

/**
 * Sort options for scan history queries
 */
export interface SorobanScanSortOptions {
  /** Sort by field */
  sortBy: 'timestamp' | 'contractName' | 'totalIssues' | 'durationMs';
  /** Sort direction */
  sortOrder: 'asc' | 'desc';
}

/**
 * Query options for retrieving scan history
 */
export interface SorobanScanQueryOptions {
  /** Filter criteria */
  filter?: SorobanScanFilter;
  /** Sort options */
  sort?: SorobanScanSortOptions;
  /** Maximum number of results to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Include full results or just metadata */
  includeResults?: boolean;
}

/**
 * Result of a scan history query
 */
export interface SorobanScanQueryResult {
  /** Scan records matching the query */
  scans: SorobanScanRecord[];
  /** Total number of scans matching the filter */
  totalCount: number;
  /** Query execution time in milliseconds */
  queryDurationMs: number;
}

/**
 * Comparison between two scans
 */
export interface SorobanScanComparison {
  /** Previous scan */
  previousScan: SorobanScanMetadata;
  /** Current scan */
  currentScan: SorobanScanMetadata;
  /** Diff between the scans */
  diff: SorobanScanDiff;
  /** Time elapsed between scans in milliseconds */
  timeElapsedMs: number;
}

/**
 * Storage configuration for scan history
 */
export interface SorobanScanHistoryStorageConfig {
  /** Maximum number of scans to retain per contract */
  maxScansPerContract?: number;
  /** Maximum age of scans to retain in milliseconds */
  maxScanAgeMs?: number;
  /** Storage directory path */
  storageDirectory?: string;
  /** Enable compression for stored scans */
  enableCompression?: boolean;
}
