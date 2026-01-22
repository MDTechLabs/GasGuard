import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScanResult, ScanError } from './interfaces/scan.interface';

@Injectable()
export class ScanService {
  private readonly logger = new Logger(ScanService.name);
  private readonly maxExecutionTime: number;

  constructor(private configService: ConfigService) {
    // Default to 30 seconds, configurable via environment variable
    this.maxExecutionTime =
      this.configService.get<number>('SCAN_MAX_EXECUTION_TIME_MS') || 30000;
    this.logger.log(
      `Scan service initialized with max execution time: ${this.maxExecutionTime}ms`,
    );
  }

  /**
   * Executes a scan with timeout protection
   * @param contractCode The contract code to scan
   * @param options Optional scan options
   * @returns Promise resolving to scan results or rejecting with timeout error
   */
  async executeScan(
    contractCode: string,
    options?: ScanOptions,
  ): Promise<ScanResult> {
    const timeoutMs = options?.timeoutMs || this.maxExecutionTime;
    const scanId = options?.scanId || this.generateScanId();

    this.logger.log(`Starting scan ${scanId} with timeout: ${timeoutMs}ms`);

    // Create a timeout promise that will reject after the max execution time
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        const error: ScanError = {
          code: 'SCAN_TIMEOUT',
          message: `Scan exceeded maximum execution time of ${timeoutMs}ms`,
          scanId,
          timeoutMs,
        };
        this.logger.warn(
          `Scan ${scanId} timed out after ${timeoutMs}ms`,
        );
        reject(error);
      }, timeoutMs);
    });

    // Create the actual scan promise
    const scanPromise = this.performScan(contractCode, scanId);

    // Race between the scan and timeout
    try {
      const result = await Promise.race([scanPromise, timeoutPromise]);
      this.logger.log(`Scan ${scanId} completed successfully`);
      return result;
    } catch (error) {
      // If it's a timeout error, re-throw it
      if (error && typeof error === 'object' && 'code' in error && error.code === 'SCAN_TIMEOUT') {
        throw error;
      }
      // Otherwise, wrap other errors
      this.logger.error(`Scan ${scanId} failed with error:`, error);
      throw {
        code: 'SCAN_ERROR',
        message: error instanceof Error ? error.message : 'Unknown scan error',
        scanId,
      } as ScanError;
    }
  }

  /**
   * Performs the actual scan operation
   * This is where the contract analysis logic would be implemented
   */
  private async performScan(
    contractCode: string,
    scanId: string,
  ): Promise<ScanResult> {
    // Simulate scan work - in real implementation, this would call the engine
    // For now, we'll add a small delay to demonstrate the timeout mechanism
    await new Promise((resolve) => setTimeout(resolve, 100));

    // TODO: Integrate with actual analysis engine
    // This is a placeholder that would be replaced with actual contract analysis
    return {
      scanId,
      status: 'completed',
      findings: [],
      executionTime: Date.now(),
    };
  }

  /**
   * Generates a unique scan ID for tracking
   */
  private generateScanId(): string {
    return `scan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Gets the current max execution time configuration
   */
  getMaxExecutionTime(): number {
    return this.maxExecutionTime;
  }
}

export interface ScanOptions {
  timeoutMs?: number;
  scanId?: string;
}
