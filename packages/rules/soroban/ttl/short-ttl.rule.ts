/**
 * Rule: soroban-short-ttl (#885)
 *
 * Flags `extend_ttl` calls whose `extend_to` value is unusually short, or whose
 * `threshold`/`extend_to` pair can never actually extend the entry.
 */

import {
  analyzeShortTtlValues,
  SOROBAN_RECOMMENDED_MIN_TTL_LEDGERS,
  SOROBAN_ABSOLUTE_MIN_TTL_LEDGERS,
} from '../../../analyzers/soroban/ttl';
import type { ShortTtlOptions, TtlFinding } from '../../../analyzers/soroban/ttl';

export interface ShortTtlRuleWarning {
  line: number;
  ruleId: string;
  severity: 'high' | 'medium' | 'low';
  key?: string;
  functionName?: string;
  message: string;
  suggestion: string;
}

function toWarning(finding: TtlFinding): ShortTtlRuleWarning {
  return {
    line: finding.line,
    ruleId: finding.ruleId,
    severity: finding.severity,
    key: finding.key,
    functionName: finding.functionName,
    message: finding.message,
    suggestion: finding.recommendation,
  };
}

export function detectShortTtlValues(
  source: string,
  options: ShortTtlOptions = {},
): ShortTtlRuleWarning[] {
  return analyzeShortTtlValues(source, options).map(toWarning);
}

export class SorobanShortTtlRule {
  public static readonly RULE_ID = 'soroban-short-ttl';

  public evaluate(source: string, options: ShortTtlOptions = {}): ShortTtlRuleWarning[] {
    return detectShortTtlValues(source, options);
  }
}

// Re-export the tuning constants so consumers can configure the thresholds.
export {
  analyzeShortTtlValues,
  SOROBAN_RECOMMENDED_MIN_TTL_LEDGERS,
  SOROBAN_ABSOLUTE_MIN_TTL_LEDGERS,
};
