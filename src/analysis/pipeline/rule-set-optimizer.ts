/**
 * Rule set optimizer for pipeline rules.
 * Detects duplicate and overlapping rules, then keeps a canonical set.
 */

import { IRule } from './types';

export interface RuleDuplicateFinding {
  keptRuleId: string;
  removedRuleId: string;
  reason: 'duplicate-id' | 'overlapping-intent';
}

export interface RuleOptimizationResult {
  optimizedRules: IRule[];
  removedRules: RuleDuplicateFinding[];
}

function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const intersection = new Set(Array.from(a).filter((x) => b.has(x)));
  const union = new Set([...Array.from(a), ...Array.from(b)]);
  if (union.size === 0) {
    return 0;
  }
  return intersection.size / union.size;
}

function intentSignature(rule: IRule): Set<string> {
  const deps = rule.getDependencies().sort().join(' ');
  const text = `${rule.name} ${rule.description} ${deps}`;
  return new Set(normalize(text));
}

function chooseCanonical(a: IRule, b: IRule): IRule {
  // Prefer the one with richer description; tie-break by stable lexical id.
  if (a.description.length !== b.description.length) {
    return a.description.length > b.description.length ? a : b;
  }
  return a.id.localeCompare(b.id) <= 0 ? a : b;
}

export function optimizeRuleSet(rules: IRule[]): RuleOptimizationResult {
  const removedRules: RuleDuplicateFinding[] = [];

  // Phase 1: Deduplicate by exact rule id.
  const byId = new Map<string, IRule>();
  for (const rule of rules) {
    const existing = byId.get(rule.id);
    if (!existing) {
      byId.set(rule.id, rule);
      continue;
    }

    const keep = chooseCanonical(existing, rule);
    const drop = keep === existing ? rule : existing;
    byId.set(rule.id, keep);
    removedRules.push({
      keptRuleId: keep.id,
      removedRuleId: drop.id,
      reason: 'duplicate-id',
    });
  }

  // Phase 2: Deduplicate by overlapping intent.
  const unique: IRule[] = [];
  for (const candidate of byId.values()) {
    const candidateSig = intentSignature(candidate);
    let merged = false;

    for (let i = 0; i < unique.length; i++) {
      const existing = unique[i];
      if (existing.getDependencies().join(',') !== candidate.getDependencies().join(',')) {
        continue;
      }

      const score = jaccard(intentSignature(existing), candidateSig);
      if (score >= 0.82) {
        const keep = chooseCanonical(existing, candidate);
        const drop = keep === existing ? candidate : existing;
        unique[i] = keep;
        removedRules.push({
          keptRuleId: keep.id,
          removedRuleId: drop.id,
          reason: 'overlapping-intent',
        });
        merged = true;
        break;
      }
    }

    if (!merged) {
      unique.push(candidate);
    }
  }

  return {
    optimizedRules: unique,
    removedRules,
  };
}
