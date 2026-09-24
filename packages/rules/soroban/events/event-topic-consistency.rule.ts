/**
 * Rule: soroban-event-topic-consistency (#916)
 * Validates consistency of event topics across contract functions.
 */

import {
  analyzeEventTopicConsistency,
  EventTopicConsistencyAnalyzer,
  TopicInconsistencyFinding,
  EventTopicConsistencyReport,
} from '../../../analyzers/soroban/events/event-topic-consistency-analyzer';

export interface TopicConsistencyRuleReport {
  findings: TopicInconsistencyFinding[];
  summary: string;
  metrics: EventTopicConsistencyReport['metrics'];
}

/**
 * Detect inconsistent Soroban event topics in source code.
 */
export function detectTopicInconsistencies(source: string): TopicConsistencyRuleReport {
  const analysis: EventTopicConsistencyReport = analyzeEventTopicConsistency(source);
  return {
    findings: analysis.findings,
    summary: analysis.summary,
    metrics: analysis.metrics,
  };
}

export class EventTopicConsistencyRule {
  public static readonly RULE_ID = 'soroban-event-topic-consistency';

  public evaluate(sourceCode: string): TopicConsistencyRuleReport {
    return detectTopicInconsistencies(sourceCode);
  }
}

export { EventTopicConsistencyAnalyzer };
