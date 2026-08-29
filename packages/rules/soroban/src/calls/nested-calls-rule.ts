/**
 * Rule: soroban-nested-calls (#771)
 * Detects unnecessarily deep Soroban contract-call chains.
 */
import { analyzeCallGraph, CallGraphFinding } from '../analyzer/callgraph-analyzer';

export interface NestedCallsFinding {
  ruleId: 'soroban-nested-calls';
  line: number;
  message: string;
  suggestion: string;
  severity: 'high' | 'medium' | 'low';
}

export function detectNestedCalls(source: string): NestedCallsFinding[] {
  const { findings } = analyzeCallGraph(source);
  return findings
    .filter((f): f is CallGraphFinding & { rule: 'soroban-nested-calls' } =>
      f.rule === 'soroban-nested-calls',
    )
    .map((f) => ({
      ruleId: 'soroban-nested-calls' as const,
      line: f.line,
      message: f.message,
      suggestion: f.suggestion,
      severity: f.severity,
    }));
}
