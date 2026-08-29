/**
 * Rule: soroban-redundant-balance-query
 *
 * Surfaces repeated token balance reads along a transaction path, separating
 * repeats whose result can safely be reused from repeats forced by an
 * intervening balance mutation.
 */
import {
  analyzeBalanceQueries,
  BalanceQuery,
  BalanceQueryFinding,
  BalanceQueryGroup,
  BalanceQueryReport,
} from '../../../../analyzers/soroban/calls/balance-query-analyzer';

export type {
  BalanceQuery,
  BalanceQueryFinding,
  BalanceQueryGroup,
  BalanceQueryReport,
};

/** All redundant-balance-query findings, including non-reusable repeats. */
export function detectRedundantBalanceQueries(source: string): BalanceQueryFinding[] {
  return analyzeBalanceQueries(source).findings;
}

/** Only the repeats whose result can safely be cached and reused. */
export function detectReusableBalanceQueries(source: string): BalanceQueryFinding[] {
  return analyzeBalanceQueries(source).findings.filter((f) => f.safeToReuse);
}

/** Full report: query sites, grouped inputs and findings. */
export function analyzeBalanceQueryUsage(source: string): BalanceQueryReport {
  return analyzeBalanceQueries(source);
}
