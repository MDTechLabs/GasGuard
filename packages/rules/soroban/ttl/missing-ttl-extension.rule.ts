/**
 * Rule: soroban-missing-ttl-extension (#886)
 * Detects persistent storage entries that may expire without an extend_ttl.
 */

import {
  analyzeMissingTtlExtensions,
  MissingTtlExtensionAnalyzer,
  type MissingTtlReport,
  type MissingTtlExtensionFinding,
} from '../../../analyzers/soroban/storage/ttl-analyzer';

export interface MissingTtlRuleReport extends MissingTtlReport {
  ruleId: 'soroban-missing-ttl-extension';
}

export type { MissingTtlExtensionFinding };

export function detectMissingTtlExtensions(source: string): MissingTtlRuleReport {
  const analysis = analyzeMissingTtlExtensions(source);
  return {
    ...analysis,
    ruleId: 'soroban-missing-ttl-extension',
  };
}

export class MissingTtlExtensionRule {
  public static readonly RULE_ID = 'soroban-missing-ttl-extension';

  public evaluate(sourceCode: string): MissingTtlRuleReport {
    return detectMissingTtlExtensions(sourceCode);
  }
}

// Re-export analyzer surface for rule consumers.
export { analyzeMissingTtlExtensions, MissingTtlExtensionAnalyzer, type MissingTtlReport };
