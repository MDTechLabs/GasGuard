/**
 * Rule family: soroban-cpu-* (#808)
 */
import {
  estimateCpuCost,
  CpuCostFinding,
  CpuCostReport,
} from '../../../../analyzers/soroban/resources/cpu/cpu-cost-estimator';

export type { CpuCostFinding, CpuCostReport };

export function detectExpensiveCpuPatterns(source: string): CpuCostFinding[] {
  return estimateCpuCost(source).findings;
}

export function analyzeCpuCost(source: string): CpuCostReport {
  return estimateCpuCost(source);
}
