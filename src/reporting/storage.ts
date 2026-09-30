import { ReportData } from './types';

export class ReportStorage {
  private reports: ReportData[] = [];

  async save(report: ReportData): Promise<void> {
    this.reports.push(report);
  }

  async list(): Promise<ReportData[]> {
    return [...this.reports];
  }

  async delete(id: string): Promise<void> {
    this.reports = this.reports.filter(r => r.id !== id);
  }

  async clear(): Promise<void> {
    this.reports = [];
  }
}