/**
 * Rule: soroban-event-emissions (#913)
 * Surfaces event-emission analysis as a GasGuard rule report.
 */

import {
  analyzeEventEmissions,
  EventEmissionAnalyzer,
  type EventAnalysisReport,
  type EventAnalyzerFinding,
  type DetectedEventEmission,
} from '../../../analyzers/soroban/events/event-analyzer';

export interface EventEmissionRuleReport extends EventAnalysisReport {
  ruleId: 'soroban-event-emissions';
}

export type { EventAnalyzerFinding, DetectedEventEmission };

export function detectEventEmissionIssues(source: string): EventEmissionRuleReport {
  const analysis = analyzeEventEmissions(source);
  return {
    ...analysis,
    ruleId: 'soroban-event-emissions',
  };
}

export class EventEmissionRule {
  public static readonly RULE_ID = 'soroban-event-emissions';

  public evaluate(sourceCode: string): EventEmissionRuleReport {
    return detectEventEmissionIssues(sourceCode);
  }
}

// Re-export analyzer surface for rule consumers.
export { analyzeEventEmissions, EventEmissionAnalyzer, type EventAnalysisReport };
