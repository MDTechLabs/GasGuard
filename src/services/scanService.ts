import { ScanResult, ScanFailure } from '../types/scanTypes';
import { ScanStorage } from '../storage/scanStorage';
import { logger } from '../utils/logger';

export class ScanService {
  private readonly storage: ScanStorage;

  constructor() {
    this.storage = new ScanStorage();
  }

  async retryFailedScans(failedScans: ScanFailure[], parallelism?: number) {
    const retryConfig = {
      maxRetries: 3,
      delay: 1000,
      backoffFactor: 2
    };

    for (const scan of failedScans) {
      let attempt = 0;
      let success = false;

      while (attempt < retryConfig.maxRetries && !success) {
        try {
          const result = await this.executeScan(scan);
          await this.storage.markScanSuccess(scan.id, result);
          success = true;
          logger.info(`Scan ${scan.id} completed successfully on attempt ${attempt + 1}`);
        } catch (error) {
          attempt++;
          const delay = retryConfig.delay * Math.pow(retryConfig.backoffFactor, attempt);
          logger.warn(`Scan ${scan.id} failed (attempt ${attempt}/${retryConfig.maxRetries}). Retrying in ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      if (!success) {
        logger.error(`Scan ${scan.id} failed after ${retryConfig.maxRetries} attempts`);
      }
    }
  }

  private async executeScan(scan: ScanFailure): Promise<ScanResult> {
    // Implementation of actual scan execution
    throw new Error('Scan execution not implemented');
  }
}