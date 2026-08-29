/**
 * Rule: soroban-repeated-ledger-access (#901)
 *
 * Identifies repeated ledger state accesses to the same key during one execution path.
 * Repeated state access increases resource consumption without providing additional information.
 */

import {
  analyzeRepeatedLedgerAccesses,
  LedgerAccess,
  RepeatedLedgerAccessFinding,
  RepeatedLedgerAccessReport,
} from '../../../analyzers/soroban/dataflow/repeated-ledger-access-analyzer';

export type { LedgerAccess, RepeatedLedgerAccessFinding, RepeatedLedgerAccessReport };

/**
 * Detect all repeated ledger accesses in Soroban Rust contract source.
 */
export function detectRepeatedLedgerAccess(source: string): RepeatedLedgerAccessFinding[] {
  return analyzeRepeatedLedgerAccesses(source).findings;
}

/**
 * Run full repeated ledger access dataflow analysis and return the complete report.
 */
export function analyzeRepeatedLedgerAccess(source: string): RepeatedLedgerAccessReport {
  return analyzeRepeatedLedgerAccesses(source);
}
