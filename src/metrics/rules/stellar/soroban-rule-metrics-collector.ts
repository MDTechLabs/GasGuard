import { SorobanRuleMetric, SorobanMetricsConfig, SorobanMetricsReport } from './types';

const DEFAULT_CONFIG: Required<SorobanMetricsConfig> = {
  slowThresholdMs: 100,
  topN: 10,
};

export class SorobanRuleMetricsCollector {
  private metrics: Map<string, SorobanRuleMetric> = new Map();
  private config: Required<SorobanMetricsConfig>;

  constructor(config?: Partial<SorobanMetricsConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  record(ruleId: string, durationMs: number, error = false): void {
    const existing = this.metrics.get(ruleId);
    if (!existing) {
      this.metrics.set(ruleId, {
        ruleId,
        invocations: 1,
        totalDurationMs: durationMs,
        minDurationMs: durationMs,
        maxDurationMs: durationMs,
        avgDurationMs: durationMs,
        errorCount: error ? 1 : 0,
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
      errorCount: existing.errorCount + (error ? 1 : 0),
      lastExecutedAt: new Date(),
    });
  }

  getMetric(ruleId: string): SorobanRuleMetric | undefined {
    return this.metrics.get(ruleId);
  }

  getAllMetrics(): SorobanRuleMetric[] {
    return Array.from(this.metrics.values());
  }

  getReport(): SorobanMetricsReport {
    const all = this.getAllMetrics();
    const totalInvocations = all.reduce((s, m) => s + m.invocations, 0);
    const totalDurationMs = all.reduce((s, m) => s + m.totalDurationMs, 0);
    return {
      totalRules: all.length,
      totalInvocations,
      totalDurationMs,
      avgDurationMs: all.length > 0 ? totalDurationMs / all.length : 0,
      slowestRules: [...all]
        .sort((a, b) => b.avgDurationMs - a.avgDurationMs)
        .slice(0, this.config.topN),
      mostInvokedRules: [...all]
        .sort((a, b) => b.invocations - a.invocations)
        .slice(0, this.config.topN),
      metrics: all,
      generatedAt: new Date(),
    };
  }

  reset(): void {
    this.metrics.clear();
  }
}
