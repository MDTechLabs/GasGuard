/**
 * Rule: soroban-missing-auth-propagation (#919)
 * Detects cross-contract call paths missing authorization propagation.
 */

import {
  analyzeAuthPropagation,
  AuthPropagationAnalyzer,
  type AuthPropagationReport,
  type AuthPropagationFinding,
  type AuthCallSite,
} from '../../../analyzers/soroban/callgraph/auth-propagation-analyzer';

export interface AuthPropagationRuleReport extends AuthPropagationReport {
  ruleId: 'soroban-missing-auth-propagation';
}

export type { AuthPropagationFinding, AuthCallSite };

export function detectMissingAuthPropagation(source: string): AuthPropagationRuleReport {
  const analysis = analyzeAuthPropagation(source);
  return {
    ...analysis,
    ruleId: 'soroban-missing-auth-propagation',
  };
}

export class AuthPropagationRule {
  public static readonly RULE_ID = 'soroban-missing-auth-propagation';

  public evaluate(sourceCode: string): AuthPropagationRuleReport {
    return detectMissingAuthPropagation(sourceCode);
  }
}

// Re-export analyzer surface for rule consumers.
export { analyzeAuthPropagation, AuthPropagationAnalyzer, type AuthPropagationReport };
