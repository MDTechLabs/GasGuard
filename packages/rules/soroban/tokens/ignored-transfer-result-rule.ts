/**
 * Issue #923 — Soroban Token Transfer Assumption Rule
 *
 * Detects code that assumes token transfers always succeed: transfer calls
 * whose returned result is never observed (`try_` Results that are
 * discarded, or captured results that are never read before advancing
 * state).
 */

import {
  analyzeIgnoredTransferResults,
} from '../../../analyzers/soroban/dataflow/ignored-transfer-result-analyzer';

import {
  IgnoredTransferResultRuleFinding,
  IgnoredTransferResultRuleReport,
} from './types';

/**
 * Detect token transfer calls, track their returned results, and identify
 * ignored outcomes in Soroban contract source.
 */
export function detectUnsafeTransferAssumptions(
  source: string,
): IgnoredTransferResultRuleReport {
  const report = analyzeIgnoredTransferResults(source);

  return {
    findings: report.findings.map((f) => ({
      ruleId: f.ruleId,
      severity: f.severity,
      line: f.line,
      fn: f.fn,
      asset: f.asset,
      method: f.method,
      message: f.message,
      suggestion: f.suggestion,
    })),
    metrics: report.metrics,
    summary: `${report.metrics.transferCalls} token transfer call(s), ${report.metrics.ignoredOutcomes} ignored outcome(s).`,
  };
}
