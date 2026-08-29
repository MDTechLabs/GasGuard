/**
 * Rule: soroban-call-frequency (#802)
 * Surfaces high-frequency internal helper calls as optimization candidates.
 */
import {
  analyzeCallFrequency,
  CallFrequencyFinding,
} from '../../../../analyzers/soroban/functions/calls/call-frequency-analyzer';

export type { CallFrequencyFinding };

export function detectHighFrequencyCalls(source: string): CallFrequencyFinding[] {
  return analyzeCallFrequency(source).findings;
}

export function analyzeFunctionCallFrequency(source: string) {
  return analyzeCallFrequency(source);
}
