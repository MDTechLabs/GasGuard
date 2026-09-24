/**
 * Rule: soroban-redundant-event (#914)
 * Detects duplicate event emissions within the same execution path.
 */

import {
  analyzeRedundantEvents,
  RedundantEventAnalyzer,
  RedundantEventFinding,
  RedundantEventReport,
} from '../../../analyzers/soroban/events/redundant-event-analyzer';

export interface RedundantEventRuleFinding extends RedundantEventFinding {
  suggestion: string;
}

export interface RedundantEventRuleReport {
  findings: RedundantEventRuleFinding[];
  summary: string;
  metrics: RedundantEventReport['metrics'];
}

/**
 * Detect redundant Soroban event emissions in source code.
 */
export function detectRedundantEvents(source: string): RedundantEventRuleReport {
  const analysis: RedundantEventReport = analyzeRedundantEvents(source);
  return {
    findings: analysis.findings,
    summary: analysis.summary,
    metrics: analysis.metrics,
  };
}

export class RedundantEventRule {
  public static readonly RULE_ID = 'soroban-redundant-event';

  public evaluate(sourceCode: string): RedundantEventRuleReport {
    return detectRedundantEvents(sourceCode);
  }
}

export { RedundantEventAnalyzer };
