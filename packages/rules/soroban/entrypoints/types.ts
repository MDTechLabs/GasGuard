/**
 * Issues #903, #904 — Soroban Entry-Point Rules Types
 */

import {
  EntryPoint,
  EntryPointAggregateMetrics,
  Severity,
} from '../../../analyzers/soroban/entrypoints/types';

import {
  ComplexityThresholds,
  EntryPointComplexity,
  OverloadDimension,
} from '../../../analyzers/soroban/complexity/types';

export type EntryPointRuleId =
  | 'soroban-unprotected-entry-point'
  | 'soroban-entry-point-call-in-loop'
  | 'soroban-entry-point-storage-in-loop'
  | 'soroban-entry-point-auth-in-loop'
  | 'soroban-entry-point-redundant-auth'
  | 'soroban-entry-point-unused-parameter'
  | 'soroban-overloaded-entry-point';

export interface EntryPointRuleFinding {
  ruleId: string;
  category: string;
  severity: Severity;
  line: number;
  entryPointName: string;
  message: string;
  suggestion: string;
  dimension?: OverloadDimension;
  metricValue?: number;
  threshold?: number;
}

export interface EntryPointRuleReport {
  findings: EntryPointRuleFinding[];
  entryPoints: EntryPoint[];
  publicCount: number;
  unprotectedCount: number;
  metrics: EntryPointAggregateMetrics;
  summary: string;
}

export interface OverloadedEntryPointRuleReport {
  findings: EntryPointRuleFinding[];
  entryPoints: EntryPointComplexity[];
  overloadedEntryPoints: EntryPointComplexity[];
  totalCount: number;
  overloadedCount: number;
  thresholds: ComplexityThresholds;
  summary: string;
}
