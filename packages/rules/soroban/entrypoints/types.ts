/**
 * Issue #903 — Soroban Entry-Point Rules Types
 */

import {
  EntryPoint,
  EntryPointFinding,
  EntryPointAggregateMetrics,
  Severity,
} from '../../../analyzers/soroban/entrypoints/types';

export type EntryPointRuleId =
  | 'soroban-unprotected-entry-point'
  | 'soroban-entry-point-call-in-loop'
  | 'soroban-entry-point-storage-in-loop'
  | 'soroban-entry-point-auth-in-loop'
  | 'soroban-entry-point-redundant-auth'
  | 'soroban-entry-point-unused-parameter';

export interface EntryPointRuleFinding {
  ruleId: string;
  category: string;
  severity: Severity;
  line: number;
  entryPointName: string;
  message: string;
  suggestion: string;
}

export interface EntryPointRuleReport {
  findings: EntryPointRuleFinding[];
  entryPoints: EntryPoint[];
  publicCount: number;
  unprotectedCount: number;
  metrics: EntryPointAggregateMetrics;
  summary: string;
}
