/**
 * Issue #903 — Soroban Entry-Point Rules
 *
 * Implements validation rules for Soroban contract entry points to detect:
 * - Unprotected public state-mutating entry points
 * - External/cross-contract calls in loops
 * - Storage writes in loops
 * - Authorization checks in loops
 * - Redundant authorization checks
 * - Unused entry-point parameters
 */

import {
  analyzeEntryPoints,
  EntryPointAnalyzerConfig,
} from '../../../analyzers/soroban/entrypoints/entry-point-analyzer';

import {
  EntryPointRuleFinding,
  EntryPointRuleReport,
} from './types';

/**
 * Detect all entry-point issues in Soroban contract source code.
 */
export function detectEntryPointIssues(
  source: string,
  config?: Partial<EntryPointAnalyzerConfig>,
): EntryPointRuleReport {
  const analysis = analyzeEntryPoints(source, 'contract.rs', config);

  const findings: EntryPointRuleFinding[] = analysis.findings.map((f) => ({
    ruleId: f.ruleId,
    category: f.category,
    severity: f.severity,
    line: f.line,
    entryPointName: f.entryPointName,
    message: f.message,
    suggestion: f.suggestion,
  }));

  return {
    findings,
    entryPoints: analysis.entryPoints,
    publicCount: analysis.metrics.publicEntryPointsCount,
    unprotectedCount: analysis.metrics.unprotectedMutatingCount,
    metrics: analysis.metrics,
    summary: analysis.summary,
  };
}

/**
 * Convenience alias to analyze Soroban entry points.
 */
export function analyzeSorobanEntryPoints(source: string): EntryPointRuleReport {
  return detectEntryPointIssues(source);
}

/**
 * Validates only authorization-related rules on entry points.
 */
export function validateEntryPointAuthorization(source: string): EntryPointRuleFinding[] {
  const report = detectEntryPointIssues(source, {
    checkMissingAuth: true,
    checkAuthInLoops: true,
    checkCallsInLoops: false,
    checkStorageInLoops: false,
    checkUnusedParams: false,
  });

  return report.findings.filter((f) => f.category === 'authorization');
}

/**
 * Validates only external-call-related rules on entry points.
 */
export function validateEntryPointExternalCalls(source: string): EntryPointRuleFinding[] {
  const report = detectEntryPointIssues(source, {
    checkCallsInLoops: true,
    checkMissingAuth: false,
    checkAuthInLoops: false,
    checkStorageInLoops: false,
    checkUnusedParams: false,
  });

  return report.findings.filter((f) => f.category === 'external_calls');
}

/**
 * Validates only storage-related rules on entry points.
 */
export function validateEntryPointStorage(source: string): EntryPointRuleFinding[] {
  const report = detectEntryPointIssues(source, {
    checkStorageInLoops: true,
    checkMissingAuth: false,
    checkAuthInLoops: false,
    checkCallsInLoops: false,
    checkUnusedParams: false,
  });

  return report.findings.filter((f) => f.category === 'storage');
}
