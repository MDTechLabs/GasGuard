/**
 * Issues #920, #921 — Soroban SAC Rules Types
 *
 * Rule-level shapes for SAC interaction detection (#920) and redundant SAC
 * operation detection (#921).
 */

export type SacRuleId =
  | 'soroban-sac-interaction'
  | 'soroban-sac-asset-operation'
  | 'soroban-sac-repeated-call'
  | 'soroban-redundant-sac-operation';

export interface SacRuleFinding {
  ruleId: SacRuleId;
  line: number;
  fn: string;
  asset: string;
  method: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  message: string;
  suggestion: string;
  /** First-occurrence line for redundant/repeated findings. */
  firstLine?: number;
  /** Occurrence count for redundant/repeated findings. */
  occurrenceCount?: number;
  /** Asset-operation category, when the finding is an asset operation. */
  operation?: string;
}

export interface SacInteractionRuleReport {
  findings: SacRuleFinding[];
  metrics: {
    totalSacCalls: number;
    assetOperations: number;
    uniqueAssets: number;
    repeatedCalls: number;
    callsInLoop: number;
  };
  summary: string;
}

export interface RedundantSacRuleReport {
  findings: SacRuleFinding[];
  metrics: {
    redundantOperations: number;
    trackedOperations: number;
  };
  summary: string;
}
