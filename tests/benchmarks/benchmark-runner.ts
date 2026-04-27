/**
 * Benchmark Suite for Performance (#246)
 *
 * Measures scan time and accuracy against benchmark datasets.
 */

export interface BenchmarkDataset {
  name: string;
  files: Array<{ path: string; content: string }>;
  expectedFindings: number;
}

export interface BenchmarkResult {
  datasetName: string;
  durationMs: number;
  findingsCount: number;
  expectedFindings: number;
  accuracy: number; // 0.0 to 1.0
}

export type ScanFn = (files: Array<{ path: string; content: string }>) => Promise<number>;

export class BenchmarkRunner {
  private datasets: BenchmarkDataset[] = [];

  addDataset(dataset: BenchmarkDataset): void {
    this.datasets.push(dataset);
  }

  async run(scanFn: ScanFn): Promise<BenchmarkResult[]> {
    const results: BenchmarkResult[] = [];

    for (const dataset of this.datasets) {
      const start = Date.now();
      const findingsCount = await scanFn(dataset.files);
      const durationMs = Date.now() - start;

      const accuracy =
        dataset.expectedFindings === 0
          ? findingsCount === 0 ? 1 : 0
          : 1 - Math.abs(findingsCount - dataset.expectedFindings) / dataset.expectedFindings;

      results.push({
        datasetName: dataset.name,
        durationMs,
        findingsCount,
        expectedFindings: dataset.expectedFindings,
        accuracy: Math.max(0, accuracy),
      });
    }

    return results;
  }

  summarize(results: BenchmarkResult[]): string {
    const lines = ['Benchmark Results:', '=================='];
    for (const r of results) {
      lines.push(
        `[${r.datasetName}] ${r.durationMs}ms | findings: ${r.findingsCount}/${r.expectedFindings} | accuracy: ${(r.accuracy * 100).toFixed(1)}%`
      );
    }
    const avgMs = results.reduce((s, r) => s + r.durationMs, 0) / (results.length || 1);
    const avgAcc = results.reduce((s, r) => s + r.accuracy, 0) / (results.length || 1);
    lines.push('------------------');
    lines.push(`Average: ${avgMs.toFixed(0)}ms | accuracy: ${(avgAcc * 100).toFixed(1)}%`);
    return lines.join('\n');
  }
}
