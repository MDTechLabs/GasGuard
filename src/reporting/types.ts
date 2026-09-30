export interface ReportData {
  id: string;
  createdAt: Date | string;
  data: {
    transactions: any[];
    summary: Record<string, any>;
  };
}

export interface RetentionConfig {
  maxAgeDays: number;
  cleanupIntervalDays: number;
  enabled: boolean;
}