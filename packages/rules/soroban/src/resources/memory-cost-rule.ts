/**
 * Rule family: soroban-memory-* (#809)
 */
import {
  estimateMemoryCost,
  MemoryFinding,
  MemoryCostReport,
} from '../../../../analyzers/soroban/resources/memory/memory-cost-estimator';

export type { MemoryFinding, MemoryCostReport };

export function detectMemoryIntensivePatterns(source: string): MemoryFinding[] {
  return estimateMemoryCost(source).findings;
}

export function analyzeMemoryCost(source: string): MemoryCostReport {
  return estimateMemoryCost(source);
}
