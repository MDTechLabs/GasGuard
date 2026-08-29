import { SorobanCiThresholdEvaluator, CiThresholdConfig, AnalysisMetrics } from '../threshold-evaluator';

describe('SorobanCiThresholdEvaluator', () => {
  let evaluator: SorobanCiThresholdEvaluator;

  beforeEach(() => {
    evaluator = new SorobanCiThresholdEvaluator();
  });

  it('should pass when metrics are within configured thresholds', () => {
    const config: CiThresholdConfig = {
      maxCpuInstructions: 100000,
      maxSeverityCounts: { high: 0 },
    };

    const metrics: AnalysisMetrics = {
      cpuInstructions: 50000,
      memoryBytes: 1024,
      storageCostStroops: 500,
      severityCounts: { high: 0, medium: 1, low: 2 },
    };

    const result = evaluator.evaluate(metrics, config);

    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('should fail CI when CPU instructions or high severity limits are breached', () => {
    const config: CiThresholdConfig = {
      maxCpuInstructions: 100000,
      maxSeverityCounts: { high: 0 },
    };

    const metrics: AnalysisMetrics = {
      cpuInstructions: 150000,
      memoryBytes: 1024,
      storageCostStroops: 500,
      severityCounts: { high: 1, medium: 0, low: 0 },
    };

    const result = evaluator.evaluate(metrics, config);

    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(2);
  });
});