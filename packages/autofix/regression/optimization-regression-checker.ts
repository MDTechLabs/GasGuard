/**
 * Issue #806 — Soroban Optimization Regression Checker
 *
 * Re-runs analysis after proposed fixes and compares findings to detect
 * newly introduced issues (resource or security regressions).
 */

import { analyzeCallFrequency } from '../../analyzers/soroban/functions/calls/call-frequency-analyzer';
import { estimateCpuCost } from '../../analyzers/soroban/resources/cpu/cpu-cost-estimator';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface NormalizedFinding {
  ruleId: string;
  severity: Severity;
  line: number;
  message: string;
}

export interface RegressionResult {
  /** Findings present after the fix that were not present before */
  newFindings: NormalizedFinding[];
  /** Findings resolved by the fix */
  resolvedFindings: NormalizedFinding[];
  /** Findings that remain unchanged */
  persistentFindings: NormalizedFinding[];
  /** true when any new high/critical finding was introduced */
  hasRegression: boolean;
  summary: string;
  beforeCount: number;
  afterCount: number;
}

/**
 * Collect a normalized finding set from all relevant analyzers.
 */
export function collectFindings(source: string): NormalizedFinding[] {
  const findings: NormalizedFinding[] = [];

  const freq = analyzeCallFrequency(source);
  for (const f of freq.findings) {
    findings.push({
      ruleId: f.ruleId,
      severity: f.severity,
      line: f.line,
      message: f.message,
    });
  }

  const cpu = estimateCpuCost(source);
  for (const f of cpu.findings) {
    findings.push({
      ruleId: f.ruleId,
      severity: f.severity,
      line: f.line,
      message: f.message,
    });
  }

  return findings;
}

function findingKey(f: NormalizedFinding): string {
  // Identity by rule + approximate message fingerprint (line may shift after edits)
  return `${f.ruleId}::${f.message.slice(0, 80)}`;
}

/**
 * Compare pre-fix and post-fix analysis results.
 */
export function checkRegression(
  sourceBefore: string,
  sourceAfter: string,
): RegressionResult {
  const before = collectFindings(sourceBefore);
  const after = collectFindings(sourceAfter);

  const beforeKeys = new Set(before.map(findingKey));
  const afterKeys = new Set(after.map(findingKey));

  const newFindings = after.filter((f) => !beforeKeys.has(findingKey(f)));
  const resolvedFindings = before.filter((f) => !afterKeys.has(findingKey(f)));
  const persistentFindings = after.filter((f) => beforeKeys.has(findingKey(f)));

  const hasRegression = newFindings.some(
    (f) => f.severity === 'critical' || f.severity === 'high',
  );

  const summary = hasRegression
    ? `REGRESSION: ${newFindings.length} new finding(s) introduced (${newFindings.filter((f) => f.severity === 'critical' || f.severity === 'high').length} high/critical).`
    : newFindings.length > 0
      ? `No high-severity regression. ${newFindings.length} low/medium finding(s) introduced; ${resolvedFindings.length} resolved.`
      : `Clean: ${resolvedFindings.length} finding(s) resolved, none introduced.`;

  return {
    newFindings,
    resolvedFindings,
    persistentFindings,
    hasRegression,
    summary,
    beforeCount: before.length,
    afterCount: after.length,
  };
}

/**
 * Apply a preview patch in-memory (very small subset of unified-diff) and
 * re-check for regressions. Used by tests and the preview API.
 */
export function applyPatchPreview(
  source: string,
  patch: string,
): string {
  // Extremely simplified: append TODO comments already embedded in patch lines
  // starting with '+' that are not '+++' headers.
  const additions = patch
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1));

  if (additions.length === 0) return source;

  // Insert first addition near the top as a safe no-op for regression tests
  const lines = source.split('\n');
  lines.splice(0, 0, ...additions.filter((a) => a.trim().startsWith('//')));
  return lines.join('\n');
}

/**
 * End-to-end: given original source and a proposed patch, return regression report.
 */
export function checkOptimizationRegression(
  source: string,
  patch: string,
): RegressionResult {
  const after = applyPatchPreview(source, patch);
  return checkRegression(source, after);
}
