/**
 * Issues #920, #921 — Soroban SAC Rules
 *
 * - #920 `detectSacInteractions`: detects interactions with Stellar Asset
 *   Contract interfaces, identifies asset operations, and tracks repeated
 *   calls (identical inputs on the same execution path).
 * - #921 `detectRedundantSacOperations`: tracks SAC operations, compares
 *   their inputs, and flags redundant calls whose earlier occurrence on the
 *   same execution path already performed the identical operation.
 */

import {
  analyzeSacInteractions,
  sacInteractionFindings,
  sacOperationCategory,
} from '../../../analyzers/soroban/sac/sac-interaction-analyzer';

import {
  RedundantSacRuleReport,
  SacInteractionRuleReport,
  SacRuleFinding,
} from './types';

/**
 * #920 — detect SAC interactions, asset operations and repeated calls.
 */
export function detectSacInteractions(source: string): SacInteractionRuleReport {
  const { interactions, assetOperations, repeatedCalls } = sacInteractionFindings(source);

  const findings: SacRuleFinding[] = [
    ...interactions.map((f) => ({
      ruleId: 'soroban-sac-interaction' as const,
      line: f.line,
      fn: f.fn,
      asset: f.asset,
      method: f.method,
      severity: f.severity,
      message: f.message,
      suggestion: f.suggestion,
    })),
    ...assetOperations.map((f) => ({
      ruleId: 'soroban-sac-asset-operation' as const,
      line: f.line,
      fn: f.fn,
      asset: f.asset,
      method: f.method,
      severity: f.severity,
      message: f.message,
      suggestion: f.suggestion,
      operation: f.operation,
    })),
    ...repeatedCalls.map((f) => ({
      ruleId: 'soroban-sac-repeated-call' as const,
      line: f.line,
      fn: f.fn,
      asset: f.asset,
      method: f.method,
      severity: f.severity,
      message: f.message,
      suggestion: f.suggestion,
      firstLine: f.firstLine,
      occurrenceCount: f.callCount,
    })),
  ];

  return {
    findings,
    metrics: {
      totalSacCalls: interactions.length,
      assetOperations: assetOperations.length,
      uniqueAssets: new Set(interactions.map((f) => f.asset)).size,
      repeatedCalls: repeatedCalls.length,
      callsInLoop: interactions.filter((f) => f.severity === 'high').length,
    },
    summary: `${interactions.length} SAC interaction(s), ${assetOperations.length} asset operation(s), ${repeatedCalls.length} repeated call(s).`,
  };
}

/**
 * #921 — compare SAC operation inputs and flag redundant calls: an
 * operation identical (asset + method + arguments) to one already performed
 * on the same execution path carries no new effect and only burns budget.
 */
export function detectRedundantSacOperations(source: string): RedundantSacRuleReport {
  const report = analyzeSacInteractions(source);

  const groups = new Map<string, typeof report.assetOperations>();
  for (const site of report.assetOperations) {
    const key = `${site.fn}|${site.asset}|${site.method}|${site.argsFingerprint}`;
    const list = groups.get(key) ?? [];
    list.push(site);
    groups.set(key, list);
  }

  const findings: SacRuleFinding[] = [];

  for (const list of groups.values()) {
    for (let i = 1; i < list.length; i++) {
      findings.push({
        ruleId: 'soroban-redundant-sac-operation' as const,
        line: list[i].line,
        fn: list[i].fn,
        asset: list[i].asset,
        method: list[i].method,
        severity: list[i].inLoop ? 'high' : 'medium',
        message: `Redundant SAC operation '${list[i].method}' on asset '${list[i].asset}' with identical inputs at line ${list[i].line} (first performed at line ${list[0].line}).`,
        suggestion:
          'Reuse the first operation result or restructure the flow so the identical asset operation is not repeated.',
        firstLine: list[0].line,
        occurrenceCount: i + 1,
        operation: sacOperationCategory(list[i].method.replace(/^try_/, '')) ?? 'transfer',
      });
    }
  }

  const redundant = findings.length;

  return {
    findings,
    metrics: {
      redundantOperations: redundant,
      trackedOperations: report.assetOperations.length,
    },
    summary: `${redundant} redundant SAC operation(s) across ${groups.size} tracked operation group(s).`,
  };
}
