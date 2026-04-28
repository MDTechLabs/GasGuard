/**
 * Rule Execution Metrics Collector
 *
 * Tracks performance metrics (execution time, invocation counts) per rule.
 */

export interface RuleMetric {
  ruleId: string;
  invocations: number;
  totalDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  avgDurationMs: number;
  lastExecutedAt: Date;
}

export class RuleMetricsCollector {
  private metrics: Map<string, RuleMetric> = new Map();

  /**
   * Record a single rule execution
   */
  record(ruleId: string, durationMs: number): void {
    const existing = this.metrics.get(ruleId);

    if (!existing) {
      this.metrics.set(ruleId, {
        ruleId,
        invocations: 1,
        totalDurationMs: durationMs,
        minDurationMs: durationMs,
        maxDurationMs: durationMs,
        avgDurationMs: durationMs,
        lastExecutedAt: new Date(),
      });
      return;
    }

    const invocations = existing.invocations + 1;
    const totalDurationMs = existing.totalDurationMs + durationMs;

    this.metrics.set(ruleId, {
      ruleId,
      invocations,
      totalDurationMs,
      minDurationMs: Math.min(existing.minDurationMs, durationMs),
      maxDurationMs: Math.max(existing.maxDurationMs, durationMs),
      avgDurationMs: totalDurationMs / invocations,
      lastExecutedAt: new Date(),
    });
  }

  /**
   * Get metrics for a specific rule
   */
  getMetric(ruleId: string): RuleMetric | undefined {
    return this.metrics.get(ruleId);
  }

  /**
   * Get all collected metrics
   */
  getAllMetrics(): RuleMetric[] {
    return Array.from(this.metrics.values());
  }

  /**
   * Get rules sorted by average duration (slowest first)
   */
  getSlowestRules(limit = 10): RuleMetric[] {
    return this.getAllMetrics()
      .sort((a, b) => b.avgDurationMs - a.avgDurationMs)
      .slice(0, limit);
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.metrics.clear();
  }
}
