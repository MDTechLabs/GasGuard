/**
 * Rule: soroban-excessive-ttl-extension (#887)
 * Detects repeated, redundant, or looped TTL extension operations.
 */

import {
  analyzeExcessiveTtlExtensions,
  ExcessiveTtlExtensionAnalyzer,
  type ExcessiveTtlReport,
  type ExcessiveTtlExtensionFinding,
} from '../../../analyzers/soroban/storage/ttl-analyzer';

export interface ExcessiveTtlRuleReport extends ExcessiveTtlReport {
  ruleId: 'soroban-excessive-ttl-extension';
}

export type { ExcessiveTtlExtensionFinding };

export function detectExcessiveTtlExtensions(source: string): ExcessiveTtlRuleReport {
  const analysis = analyzeExcessiveTtlExtensions(source);
  return {
    ...analysis,
    ruleId: 'soroban-excessive-ttl-extension',
  };
}

export class ExcessiveTtlExtensionRule {
  public static readonly RULE_ID = 'soroban-excessive-ttl-extension';

  public evaluate(sourceCode: string): ExcessiveTtlRuleReport {
    return detectExcessiveTtlExtensions(sourceCode);
  }
}

// Re-export analyzer surface for rule consumers.
export { analyzeExcessiveTtlExtensions, ExcessiveTtlExtensionAnalyzer, type ExcessiveTtlReport };
