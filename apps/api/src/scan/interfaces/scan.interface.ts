/**
 * Result of a contract scan operation
 */
export interface ScanResult {
  scanId: string;
  status: 'completed' | 'failed' | 'timeout';
  findings: ScanFinding[];
  executionTime: number;
  metadata?: {
    contractSize?: number;
    rulesApplied?: string[];
  };
}

/**
 * Individual finding from a scan
 */
export interface ScanFinding {
  ruleId: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  location?: {
    line: number;
    column: number;
    file?: string;
  };
  suggestion?: string;
}

/**
 * Error structure for scan failures
 */
export interface ScanError {
  code: 'SCAN_TIMEOUT' | 'SCAN_ERROR' | 'INVALID_INPUT';
  message: string;
  scanId?: string;
  timeoutMs?: number;
  details?: unknown;
}
