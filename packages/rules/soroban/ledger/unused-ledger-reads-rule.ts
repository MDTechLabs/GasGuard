/**
 * Rule: soroban-unused-ledger-read (#902)
 *
 * Identifies ledger state reads whose results are not consumed by subsequent logic.
 * Unused reads consume unnecessary storage-read and CPU budget in Soroban transactions.
 */

import {
  analyzeUnusedLedgerReads,
  LedgerRead,
  LedgerReadReport,
  UnusedLedgerReadFinding,
} from '../../../analyzers/soroban/dataflow/unused-ledger-read-analyzer';

export type { LedgerRead, LedgerReadReport, UnusedLedgerReadFinding };

/**
 * Detect all unused ledger reads in Soroban Rust contract source.
 */
export function detectUnusedLedgerReads(source: string): UnusedLedgerReadFinding[] {
  return analyzeUnusedLedgerReads(source).findings;
}

/**
 * Run full ledger read dataflow analysis and return the complete report.
 */
export function analyzeLedgerReadUsage(source: string): LedgerReadReport {
  return analyzeUnusedLedgerReads(source);
}
