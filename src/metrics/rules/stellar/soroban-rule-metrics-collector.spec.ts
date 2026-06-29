import { SorobanRuleMetricsCollector } from './soroban-rule-metrics-collector';

describe('SorobanRuleMetricsCollector', () => {
  let collector: SorobanRuleMetricsCollector;

  beforeEach(() => {
    collector = new SorobanRuleMetricsCollector();
  });

  describe('record', () => {
    it('should record a new rule metric', () => {
      collector.record('soroban-storage', 50);
      const metric = collector.getMetric('soroban-storage');
      expect(metric).toBeDefined();
      expect(metric!.invocations).toBe(1);
      expect(metric!.avgDurationMs).toBe(50);
    });

    it('should accumulate invocations and recalculate averages', () => {
      collector.record('rule-a', 100);
      collector.record('rule-a', 200);
      const metric = collector.getMetric('rule-a');
      expect(metric!.invocations).toBe(2);
      expect(metric!.totalDurationMs).toBe(300);
      expect(metric!.avgDurationMs).toBe(150);
      expect(metric!.minDurationMs).toBe(100);
      expect(metric!.maxDurationMs).toBe(200);
    });

    it('should track errors', () => {
      collector.record('rule-b', 10, true);
      expect(collector.getMetric('rule-b')!.errorCount).toBe(1);
    });
  });

  describe('getReport', () => {
    it('should return a report with correct totals', () => {
      collector.record('rule-a', 100);
      collector.record('rule-b', 200);
      const report = collector.getReport();
      expect(report.totalRules).toBe(2);
      expect(report.totalInvocations).toBe(2);
      expect(report.totalDurationMs).toBe(300);
    });

    it('should list slowest rules first', () => {
      collector.record('slow', 500);
      collector.record('fast', 10);
      const report = collector.getReport();
      expect(report.slowestRules[0].ruleId).toBe('slow');
    });
  });

  describe('reset', () => {
    it('should clear all metrics', () => {
      collector.record('rule-a', 50);
      collector.reset();
      expect(collector.getAllMetrics()).toHaveLength(0);
    });
  });
});
