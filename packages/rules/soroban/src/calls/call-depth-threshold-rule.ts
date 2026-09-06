/**
 * Rule: soroban-call-depth-threshold (#879)
 * Warns when contract call depth exceeds configured limits.
 */
import {
  analyzeCallDepth,
  CallDepthFinding,
} from '../../../../analyzers/soroban/callgraph/call-depth-analyzer';

export interface CallDepthRuleFinding {
  ruleId: 'soroban-call-depth-threshold';
  line: number;
  message: string;
  suggestion: string;
  severity: 'high' | 'medium';
}

export function detectCallDepthThresholdExceeded(
  source: string,
  options?: { maxDepth?: number },
): CallDepthRuleFinding[] {
  const findings = analyzeCallDepth(source, options);
  return findings.map((f) => ({
    ruleId: 'soroban-call-depth-threshold' as const,
    line: f.line,
    message: f.message,
    suggestion: f.suggestion,
    severity: f.severity,
  }));
}
