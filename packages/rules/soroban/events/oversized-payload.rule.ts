/**
 * Rule: soroban-oversized-event-payload (#915)
 * Detects events carrying unnecessarily large payloads.
 */

import {
  analyzeEventPayloadSizes,
  EventPayloadSizeAnalyzer,
  EventPayloadSizeOptions,
  OversizedPayloadFinding,
  EventPayloadSizeReport,
} from '../../../analyzers/soroban/serialization/event-payload-size-analyzer';

export interface OversizedPayloadRuleReport {
  findings: OversizedPayloadFinding[];
  summary: string;
  metrics: EventPayloadSizeReport['metrics'];
}

/**
 * Detect oversized Soroban event payloads in source code.
 */
export function detectOversizedPayloads(
  source: string,
  options?: EventPayloadSizeOptions,
): OversizedPayloadRuleReport {
  const analysis: EventPayloadSizeReport = analyzeEventPayloadSizes(source, options);
  return {
    findings: analysis.findings,
    summary: analysis.summary,
    metrics: analysis.metrics,
  };
}

export class OversizedPayloadRule {
  public static readonly RULE_ID = 'soroban-oversized-event-payload';

  public evaluate(sourceCode: string, options?: EventPayloadSizeOptions): OversizedPayloadRuleReport {
    return detectOversizedPayloads(sourceCode, options);
  }
}

export { EventPayloadSizeAnalyzer };
