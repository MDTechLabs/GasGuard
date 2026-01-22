import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'worker_threads';
import { join } from 'path';
import { ScanResult, ScanError } from '../scan/interfaces/scan.interface';

/**
 * Worker-based scan service that provides additional isolation
 * for long-running scans. Uses Node.js worker threads to prevent
 * blocking the main event loop.
 */
@Injectable()
export class WorkerScanService {
  private readonly logger = new Logger(WorkerScanService.name);
  private readonly maxExecutionTime: number;

  constructor(private configService: ConfigService) {
    this.maxExecutionTime =
      this.configService.get<number>('SCAN_MAX_EXECUTION_TIME_MS') || 30000;
    this.logger.log(
      `Worker scan service initialized with max execution time: ${this.maxExecutionTime}ms`,
    );
  }

  /**
   * Executes a scan in a worker thread with timeout protection
   * @param contractCode The contract code to scan
   * @param options Optional scan options
   * @returns Promise resolving to scan results or rejecting with timeout error
   */
  async executeScanInWorker(
    contractCode: string,
    options?: { timeoutMs?: number; scanId?: string },
  ): Promise<ScanResult> {
    const timeoutMs = options?.timeoutMs || this.maxExecutionTime;
    const scanId = options?.scanId || this.generateScanId();

    this.logger.log(
      `Starting worker scan ${scanId} with timeout: ${timeoutMs}ms`,
    );

    return new Promise<ScanResult>((resolve, reject) => {
      // Create worker thread
      // In production, use compiled .js file; in development, use .ts with ts-node
      const isProduction = process.env.NODE_ENV === 'production';
      const workerPath = isProduction
        ? join(__dirname, 'workers', 'scan.worker.js')
        : join(__dirname, 'workers', 'scan.worker.ts');
      const worker = new Worker(workerPath, {
        workerData: { contractCode, scanId },
        ...(isProduction ? {} : { execArgv: ['-r', 'ts-node/register'] }),
      });

      let isResolved = false;

      // Set up timeout
      const timeout = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          worker.terminate(); // Force terminate the worker
          const error: ScanError = {
            code: 'SCAN_TIMEOUT',
            message: `Worker scan exceeded maximum execution time of ${timeoutMs}ms`,
            scanId,
            timeoutMs,
          };
          this.logger.warn(`Worker scan ${scanId} timed out after ${timeoutMs}ms`);
          reject(error);
        }
      }, timeoutMs);

      // Handle worker messages
      worker.on('message', (result: ScanResult | ScanError) => {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timeout);

          if ('code' in result && result.code) {
            // It's an error
            this.logger.error(`Worker scan ${scanId} failed:`, result);
            reject(result as ScanError);
          } else {
            // It's a successful result
            this.logger.log(`Worker scan ${scanId} completed successfully`);
            resolve(result as ScanResult);
          }
        }
      });

      // Handle worker errors
      worker.on('error', (error) => {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timeout);
          this.logger.error(`Worker scan ${scanId} encountered an error:`, error);
          reject({
            code: 'SCAN_ERROR',
            message: error.message,
            scanId,
            details: error,
          } as ScanError);
        }
      });

      // Handle worker exit
      worker.on('exit', (code) => {
        if (!isResolved && code !== 0) {
          isResolved = true;
          clearTimeout(timeout);
          this.logger.error(`Worker scan ${scanId} exited with code ${code}`);
          reject({
            code: 'SCAN_ERROR',
            message: `Worker exited unexpectedly with code ${code}`,
            scanId,
          } as ScanError);
        }
      });
    });
  }

  /**
   * Generates a unique scan ID for tracking
   */
  private generateScanId(): string {
    return `worker_scan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Gets the current max execution time configuration
   */
  getMaxExecutionTime(): number {
    return this.maxExecutionTime;
  }
}
