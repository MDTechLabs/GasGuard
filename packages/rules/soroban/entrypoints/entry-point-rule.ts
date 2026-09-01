/**
 * Issues #903, #904 — Soroban Entry-Point Rules
 *
 * Implements validation rules for Soroban contract entry points to detect:
 * - Overloaded entry points handling excessive responsibilities (#904)
 * - Unprotected public state-mutating entry points (#903)
 * - External/cross-contract calls in loops (#903)
 * - Storage writes in loops (#903)
 * - Authorization checks in loops (#903)
 * - Redundant authorization checks (#903)
 * - Unused entry-point parameters (#903)
 */

import {
  analyzeEntryPoints,
  EntryPointAnalyzerConfig,
} from '../../../analyzers/soroban/entrypoints/entry-point-analyzer';

import {
  analyzeEntryPointComplexity,
  ComplexityThresholds,
} from '../../../analyzers/soroban/complexity/complexity-analyzer';

import {
  EntryPointRuleFinding,
  EntryPointRuleReport,
  OverloadedEntryPointRuleReport,
} from './types';

/**
 * Detect all entry-point issues in Soroban contract source code,
 * including structural authorization/storage/call issues and complexity overloads.
 */
export function detectEntryPointIssues(
  source: string,
  config?: Partial<EntryPointAnalyzerConfig>,
  complexityThresholds?: Partial<ComplexityThresholds>,
): EntryPointRuleReport {
  const analysis = analyzeEntryPoints(source, 'contract.rs', config);
  const complexityReport = analyzeEntryPointComplexity(source, 'contract.rs', complexityThresholds);

  const findings: EntryPointRuleFinding[] = analysis.findings.map((f) => ({
    ruleId: f.ruleId,
    category: f.category,
    severity: f.severity,
    line: f.line,
    entryPointName: f.entryPointName,
    message: f.message,
    suggestion: f.suggestion,
  }));

  // Append complexity & overload findings
  complexityReport.findings.forEach((cf) => {
    findings.push({
      ruleId: cf.ruleId,
      category: 'complexity',
      severity: cf.severity,
      line: cf.line,
      entryPointName: cf.entryPointName,
      message: cf.message,
      suggestion: cf.suggestion,
      dimension: cf.dimension,
      metricValue: cf.metricValue,
      threshold: cf.threshold,
    });
  });

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
 * Detect overloaded entry points handling excessive responsibilities (Issue #904).
 */
export function detectOverloadedEntryPoints(
  source: string,
  thresholds?: Partial<ComplexityThresholds>,
): OverloadedEntryPointRuleReport {
  const complexityReport = analyzeEntryPointComplexity(source, 'contract.rs', thresholds);

  const findings: EntryPointRuleFinding[] = complexityReport.findings.map((f) => ({
    ruleId: f.ruleId,
    category: 'complexity',
    severity: f.severity,
    line: f.line,
    entryPointName: f.entryPointName,
    message: f.message,
    suggestion: f.suggestion,
    dimension: f.dimension,
    metricValue: f.metricValue,
    threshold: f.threshold,
  }));

  return {
    findings,
    entryPoints: complexityReport.entryPoints,
    overloadedEntryPoints: complexityReport.overloadedEntryPoints,
    totalCount: complexityReport.totalEntryPoints,
    overloadedCount: complexityReport.overloadedCount,
    thresholds: complexityReport.thresholds,
    summary: complexityReport.summary,
  };
}

/**
 * Validates only complexity and overload rules on entry points.
 */
export function validateEntryPointComplexity(
  source: string,
  thresholds?: Partial<ComplexityThresholds>,
): EntryPointRuleFinding[] {
  const report = detectOverloadedEntryPoints(source, thresholds);
  return report.findings;
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
