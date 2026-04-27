/**
 * Benchmark Suite Spec (#246)
 */

import { BenchmarkRunner, BenchmarkDataset } from './benchmark-runner';

describe('BenchmarkRunner', () => {
  let runner: BenchmarkRunner;

  beforeEach(() => {
    runner = new BenchmarkRunner();
  });

  it('runs benchmarks and returns results', async () => {
    const dataset: BenchmarkDataset = {
      name: 'soroban-basic',
      files: [{ path: 'contract.rs', content: 'fn main() {}' }],
      expectedFindings: 2,
    };
    runner.addDataset(dataset);

    const mockScan = jest.fn().mockResolvedValue(2);
    const results = await runner.run(mockScan);

    expect(results).toHaveLength(1);
    expect(results[0].datasetName).toBe('soroban-basic');
    expect(results[0].findingsCount).toBe(2);
    expect(results[0].accuracy).toBe(1);
    expect(results[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('calculates accuracy correctly for partial matches', async () => {
    runner.addDataset({ name: 'test', files: [], expectedFindings: 4 });
    const results = await runner.run(async () => 2);
    expect(results[0].accuracy).toBe(0.5);
  });

  it('handles zero expected findings', async () => {
    runner.addDataset({ name: 'clean', files: [], expectedFindings: 0 });
    const results = await runner.run(async () => 0);
    expect(results[0].accuracy).toBe(1);
  });

  it('summarizes results', async () => {
    runner.addDataset({ name: 'ds1', files: [], expectedFindings: 1 });
    const results = await runner.run(async () => 1);
    const summary = runner.summarize(results);
    expect(summary).toContain('ds1');
    expect(summary).toContain('100.0%');
  });
});
