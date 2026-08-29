export interface SorobanRuleMetric {
  ruleId: string;
  invocations: number;
  totalDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  avgDurationMs: number;
  errorCount: number;
  lastExecutedAt: Date;
}

export interface SorobanMetricsReport {
  totalRules: number;
  totalInvocations: number;
  totalDurationMs: number;
  avgDurationMs: number;
  slowestRules: SorobanRuleMetric[];
  mostInvokedRules: SorobanRuleMetric[];
  metrics: SorobanRuleMetric[];
  generatedAt: Date;
}

export interface SorobanMetricsConfig {
  slowThresholdMs: number;
  topN: number;
}
