import { ScanFailure, ScanResult } from '../types/scanTypes';
import { logger } from '../utils/logger';

export class ScanStorage {
  private failedScans: ScanFailure[] = [];

  async getFailedScans(limit?: number): Promise<ScanFailure[]> {
    if (limit) {
      return this.failedScans.slice(0, limit);
    }
    return [...this.failedScans];
  }

  async markScanSuccess(scanId: string, result: ScanResult): Promise<void> {
    this.failedScans = this.failedScans.filter(scan => scan.id !== scanId);
    logger.info(`Scan ${scanId} marked as successful`);
  }

  async recordScanFailure(failure: ScanFailure): Promise<void> {
    this.failedScans.push(failure);
    logger.warn(`Scan ${failure.id} marked as failed`);
  }
}