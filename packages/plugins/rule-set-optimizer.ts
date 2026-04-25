/**
 * Optimizer for plugin-contributed rule manifests.
 * Used to detect duplicate and overlapping rule definitions.
 */

import { PluginRuleDefinition } from './plugin-manifest';

export interface PluginRuleDuplicate {
  keptRuleId: string;
  removedRuleId: string;
  reason: 'duplicate-id' | 'overlapping-intent';
}

export interface PluginRuleOptimizationResult {
  optimizedRules: PluginRuleDefinition[];
  removedRules: PluginRuleDuplicate[];
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

function intentSignature(rule: PluginRuleDefinition): Set<string> {
  return new Set(normalize(`${rule.id} ${rule.name} ${rule.description}`));
}

function chooseCanonical(a: PluginRuleDefinition, b: PluginRuleDefinition): PluginRuleDefinition {
  if (a.description.length !== b.description.length) {
    return a.description.length > b.description.length ? a : b;
  }
  return a.id.localeCompare(b.id) <= 0 ? a : b;
}

export function optimizePluginRules(
  rules: PluginRuleDefinition[],
): PluginRuleOptimizationResult {
  const removedRules: PluginRuleDuplicate[] = [];

  const byId = new Map<string, PluginRuleDefinition>();
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

  const unique: PluginRuleDefinition[] = [];
  for (const candidate of byId.values()) {
    const candidateSig = intentSignature(candidate);
    let merged = false;

    for (let i = 0; i < unique.length; i++) {
      const existing = unique[i];
      const score = jaccard(intentSignature(existing), candidateSig);
      if (score >= 0.85) {
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
