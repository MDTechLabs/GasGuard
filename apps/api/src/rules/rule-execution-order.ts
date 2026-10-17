/**
 * Deterministic rule execution ordering (#1155).
 *
 * Findings must be reproducible for the same commit, configuration and
 * rule-pack version, which means the order rules run in cannot depend on the
 * order they happen to be discovered or on map iteration. Rules are sorted by
 * a fixed severity rank and then by rule id, so the same rule set always
 * produces the same execution sequence.
 *
 * Rules with an unknown severity sort after every known severity but still in
 * rule-id order, and the input array is never mutated.
 */

export const RULE_SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const UNKNOWN_SEVERITY_RANK = Number.MAX_SAFE_INTEGER;

export interface OrderableRule {
  ruleId: string;
  severity?: string;
}

export function severityRank(severity?: string): number {
  if (!severity) {
    return UNKNOWN_SEVERITY_RANK;
  }
  const rank = RULE_SEVERITY_RANK[severity.toLowerCase()];
  return rank === undefined ? UNKNOWN_SEVERITY_RANK : rank;
}

/**
 * Return the rules in deterministic execution order.
 *
 * Ties are broken by rule id using a locale-independent comparison, so the
 * result is identical across machines and locales.
 */
export function orderRulesForExecution<T extends OrderableRule>(
  rules: readonly T[],
): T[] {
  return [...rules].sort((left, right) => {
    const bySeverity = severityRank(left.severity) - severityRank(right.severity);
    if (bySeverity !== 0) {
      return bySeverity;
    }
    return compareRuleIds(left.ruleId, right.ruleId);
  });
}

export function compareRuleIds(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}
