import { ReportStorage } from '../storage';
import { RetentionConfig, ReportData } from '../types';

export class DataRetentionPolicy {
  constructor(private config: RetentionConfig) {}

  async enforce(storage: ReportStorage): Promise<ReportData[]> {
    console.log('Retention enforcement started');
    if (!this.config.enabled) {
      console.log('Retention policy disabled');
      return storage.list();
    }

    const allReports = await storage.list();
    const now = new Date();
    const cutoffDate = new Date(now);
    cutoffDate.setDate(cutoffDate.getDate() - this.config.maxAgeDays);

    const toRetain = allReports.filter(report => {
      try {
        const reportDate = new Date(report.createdAt);
        return reportDate >= cutoffDate;
      } catch {
        return false;
      }
    });

    const toDelete = allReports.filter(report => !toRetain.includes(report));
    await Promise.all(toDelete.map(report => storage.delete(report.id)));

    console.log(`Retention enforcement completed. Retained: ${toRetain.length}, Deleted: ${toDelete.length}`);
    return toRetain;
  }
}