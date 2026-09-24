/**
 * Issue #923 — Soroban Token Rules Types
 */

export type SorobanTokenRuleId = 'soroban-ignored-transfer-result';

export interface IgnoredTransferResultRuleFinding {
  ruleId: SorobanTokenRuleId;
  severity: 'critical' | 'high' | 'medium' | 'low';
  line: number;
  fn: string;
  asset: string;
  method: string;
  message: string;
  suggestion: string;
}

export interface IgnoredTransferResultRuleReport {
  findings: IgnoredTransferResultRuleFinding[];
  metrics: {
    transferCalls: number;
    ignoredOutcomes: number;
  };
  summary: string;
}
