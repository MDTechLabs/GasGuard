/**
 * Rule: soroban-ttl-analyzer (#885)
 *
 * Aggregate TTL rule that surfaces every finding produced by the Soroban TTL
 * analyzer — missing extensions, excessive extensions, and short/invalid TTL
 * values — as flat, line-addressable warnings.
 */

import { SorobanTtlAnalyzer } from '../../../analyzers/soroban/ttl';
import type {
  ShortTtlOptions,
  SorobanTtlAnalysisResult,
  TtlFinding,
} from '../../../analyzers/soroban/ttl';

export interface TtlRuleWarning {
  line: number;
  ruleId: string;
  severity: 'high' | 'medium' | 'low';
  key?: string;
  functionName?: string;
  message: string;
  suggestion: string;
  kind: TtlFinding['kind'];
}

export class SorobanTtlRule {
  public static readonly RULE_ID = 'soroban-ttl-analyzer';

  private readonly analyzer: SorobanTtlAnalyzer;

  constructor() {
    this.analyzer = new SorobanTtlAnalyzer();
  }

  public analyze(source: string, options: ShortTtlOptions = {}): TtlRuleWarning[] {
    return this.analyzer.analyze(source, options).findings.map(
      (finding): TtlRuleWarning => ({
        line: finding.line,
        ruleId: finding.ruleId,
        severity: finding.severity,
        key: finding.key,
        functionName: finding.functionName,
        message: finding.message,
        suggestion: finding.recommendation,
        kind: finding.kind,
      }),
    );
  }

  public getFullAnalysis(
    source: string,
    options: ShortTtlOptions = {},
  ): SorobanTtlAnalysisResult {
    return this.analyzer.analyze(source, options);
  }
}

export function detectTtlIssues(
  source: string,
  options: ShortTtlOptions = {},
): TtlRuleWarning[] {
  return new SorobanTtlRule().analyze(source, options);
}
