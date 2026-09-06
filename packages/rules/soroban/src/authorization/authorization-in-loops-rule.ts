/**
 * Rule: soroban-auth-in-loops (#874)
 * Detects Soroban authorization checks inside loops.
 */
import {
  analyzeAuthorizationLoops,
  AuthLoopFinding,
} from '../../../../analyzers/soroban/loops/authorization-loop-analyzer';

export interface AuthInLoopsRuleFinding {
  ruleId: 'soroban-auth-in-loops';
  line: number;
  message: string;
  suggestion: string;
  severity: 'high';
}

export function detectAuthorizationInLoops(source: string): AuthInLoopsRuleFinding[] {
  const findings = analyzeAuthorizationLoops(source);
  return findings.map((f) => ({
    ruleId: 'soroban-auth-in-loops' as const,
    line: f.line,
    message: f.message,
    suggestion: f.suggestion,
    severity: f.severity,
  }));
}
