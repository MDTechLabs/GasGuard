/**
 * Rule: soroban-recursive-calls (#878)
 * Detects recursive contract calls and cyclic invocation paths.
 */
import {
  analyzeRecursiveCalls,
  RecursiveCallFinding,
} from '../../../../analyzers/soroban/callgraph/recursive-call-analyzer';

export interface RecursiveCallRuleFinding {
  ruleId: 'soroban-recursive-calls';
  line: number;
  message: string;
  suggestion: string;
  severity: 'high' | 'medium';
}

export function detectRecursiveContractCalls(source: string): RecursiveCallRuleFinding[] {
  const findings = analyzeRecursiveCalls(source);
  return findings.map((f) => ({
    ruleId: 'soroban-recursive-calls' as const,
    line: f.line,
    message: f.message,
    suggestion: f.suggestion,
    severity: f.severity,
  }));
}
