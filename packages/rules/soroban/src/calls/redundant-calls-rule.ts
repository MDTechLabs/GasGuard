/**
 * Rule: soroban-redundant-call (#773)
 * Detects repeated calls to the same contract function with identical arguments.
 */
import { analyzeCallGraph, CallGraphFinding } from '../analyzer/callgraph-analyzer';

export interface RedundantCallFinding {
  ruleId: 'soroban-redundant-call';
  line: number;
  message: string;
  suggestion: string;
  severity: 'high' | 'medium' | 'low';
}

export function detectRedundantCalls(source: string): RedundantCallFinding[] {
  const { findings } = analyzeCallGraph(source);
  return findings
    .filter((f): f is CallGraphFinding & { rule: 'soroban-redundant-call' } =>
      f.rule === 'soroban-redundant-call',
    )
    .map((f) => ({
      ruleId: 'soroban-redundant-call' as const,
      line: f.line,
      message: f.message,
      suggestion: f.suggestion,
      severity: f.severity,
    }));
}
