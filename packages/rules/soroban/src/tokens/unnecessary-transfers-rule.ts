/**
 * Rule: soroban-unnecessary-token-transfer
 *
 * Surfaces token transfers that can be avoided or consolidated. Findings marked
 * `preserved` are security-sensitive — they are reported for visibility but no
 * consolidation is proposed.
 */
import {
  analyzeTokenTransfers,
  TokenTransferFinding,
  TokenTransferReport,
  TransferEdge,
  TransferPath,
  TransferSite,
} from '../../../../analyzers/soroban/callgraph/token-transfer-analyzer';

export type {
  TokenTransferFinding,
  TokenTransferReport,
  TransferEdge,
  TransferPath,
  TransferSite,
};

/** All unnecessary-transfer findings, including preserved ones. */
export function detectUnnecessaryTransfers(source: string): TokenTransferFinding[] {
  return analyzeTokenTransfers(source).findings;
}

/**
 * Only the findings that are safe to act on — transfers guarded by auth checks,
 * branches or loops are filtered out.
 */
export function detectConsolidatableTransfers(source: string): TokenTransferFinding[] {
  return analyzeTokenTransfers(source).findings.filter((f) => !f.preserved);
}

/** Full transfer-graph report: sites, edges, multi-hop paths and findings. */
export function analyzeTransferGraph(source: string): TokenTransferReport {
  return analyzeTokenTransfers(source);
}
