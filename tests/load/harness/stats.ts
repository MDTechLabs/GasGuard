export interface LatencySummary {
  count: number;
  min: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

/** Nearest-rank percentile of an ascending array. Empty input gives 0. */
export function percentile(sortedAscending: readonly number[], p: number): number {
  if (!(p >= 0 && p <= 100)) {
    throw new RangeError("percentile must be within [0, 100]");
  }
  if (sortedAscending.length === 0) {
    return 0;
  }
  const rank = Math.ceil((p / 100) * sortedAscending.length);
  return sortedAscending[Math.min(sortedAscending.length, Math.max(1, rank)) - 1];
}

export function summarize(values: readonly number[]): LatencySummary {
  for (const v of values) {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new TypeError("latency samples must be finite numbers");
    }
  }
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((sum, v) => sum + v, 0);
  return {
    count: sorted.length,
    min: sorted.length ? sorted[0] : 0,
    mean: sorted.length ? Math.round((total / sorted.length) * 1000) / 1000 : 0,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.length ? sorted[sorted.length - 1] : 0,
  };
}
