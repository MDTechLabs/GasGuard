/**
 * Rule: soroban-cross-contract-call (#772)
 * Tracks and reports cross-contract call patterns.
 */
import { analyzeCallGraph, CallGraphFinding } from '../analyzer/callgraph-analyzer';

export interface CrossContractCallFinding {
  ruleId: 'soroban-cross-contract-call';
  line: number;
  message: string;
  suggestion: string;
  severity: 'high' | 'medium' | 'low';
}

export function detectCrossContractCalls(source: string): CrossContractCallFinding[] {
  const { findings } = analyzeCallGraph(source);
  return findings
    .filter((f): f is CallGraphFinding & { rule: 'soroban-cross-contract-call' } =>
      f.rule === 'soroban-cross-contract-call',
    )
    .map((f) => ({
      ruleId: 'soroban-cross-contract-call' as const,
      line: f.line,
      message: f.message,
      suggestion: f.suggestion,
      severity: f.severity,
    }));
}
