import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ScannerWorkerPool, ScanTask, ScanResult } from './scanner-worker.pool';

export interface BatchScanProgress {
  total: number;
  completed: number;
  percentage: number;
  currentFile: string;
}

export interface BatchScanReport {
  totalFiles: number;
  totalAstNodes: number;
  totalWarnings: number;
  totalOptimizations: number;
  durationMs: number;
  results: ScanResult[];
}

@Injectable()
export class ScannerService implements OnModuleInit, OnModuleDestroy {
  private workerPool: ScannerWorkerPool;

  constructor() {
    this.workerPool = new ScannerWorkerPool();
  }

  async onModuleInit() {
    await this.workerPool.initialize();
  }

  async onModuleDestroy() {
    await this.workerPool.terminate();
  }

  /**
   * Scans a batch of contract files using worker threads in parallel.
   */
  public async scanBatch(
    tasks: ScanTask[],
    onProgress?: (progress: BatchScanProgress) => void
  ): Promise<BatchScanReport> {
    const startTime = Date.now();
    let completed = 0;
    const results: ScanResult[] = [];

    const promises = tasks.map(async (task) => {
      const res = await this.workerPool.executeTask(task);
      completed++;
      results.push(res);

      if (onProgress) {
        onProgress({
          total: tasks.length,
          completed,
          percentage: Math.round((completed / tasks.length) * 100),
          currentFile: task.filePath,
        });
      }

      return res;
    });

    await Promise.all(promises);

    const durationMs = Date.now() - startTime;
    const totalAstNodes = results.reduce((acc, r) => acc + r.astNodesCount, 0);
    const totalWarnings = results.reduce((acc, r) => acc + r.warningsCount, 0);

    const totalOptimizations = results.reduce(
      (acc, r) => acc + (((r as any).optimizationFindings || []).length as number),
      0
    );

    return {
      totalFiles: tasks.length,
      totalAstNodes,
      totalWarnings,
      totalOptimizations,
      durationMs,
      results,
    };
  }
}
