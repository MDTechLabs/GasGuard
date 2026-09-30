import { ReportData, RetentionConfig } from '../types';

export const mockReportData = (overrides: Partial<ReportData> = {}): ReportData => ({
  id: `report-${Math.random().toString(36).substring(2, 9)}`,
  createdAt: new Date(),
  data: { transactions: [], summary: {} },
  ...overrides
});

export const mockRetentionConfig: RetentionConfig = {
  maxAgeDays: 30,
  cleanupIntervalDays: 1,
  enabled: true
};