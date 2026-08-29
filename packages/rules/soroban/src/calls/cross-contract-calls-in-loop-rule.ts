/**
 * Rule: soroban-cross-contract-calls-in-loop (#876)
 * Detects cross-contract calls executed repeatedly inside loops.
 */
import {
  detectCrossContractCallsInLoops,
  CrossContractCallInLoopSite,
} from '../../../../analyzers/soroban/calls/cross-contract-calls-in-loop-analyzer';

export interface CrossContractCallInLoopFinding {
  ruleId: 'soroban-cross-contract-calls-in-loop';
  line: number;
  message: string;
  suggestion: string;
  severity: 'critical' | 'high' | 'medium';
  targetContract: string;
  method: string;
  boundType: string;
}

export function detectCrossContractCallsInsideLoops(source: string): CrossContractCallInLoopFinding[] {
  const sites = detectCrossContractCallsInLoops(source);
  return sites.map((s: CrossContractCallInLoopSite) => ({
    ruleId: 'soroban-cross-contract-calls-in-loop' as const,
    line: s.line,
    message: s.message,
    suggestion: s.suggestion,
    severity: s.severity,
    targetContract: s.targetContract,
    method: s.method,
    boundType: s.loopContext.boundType,
  }));
}
