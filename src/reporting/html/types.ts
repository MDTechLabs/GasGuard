import { AnalysisResult } from '../../analysis/filter/analysis-filter';

export interface ReportMetrics {
  totalFiles: number;
  totalIssues: number;
  criticalIssues: number;
  highIssues: number;
  mediumIssues: number;
  lowIssues: number;
  scannedAt: Date;
  durationMs: number;
}

export interface ReportData {
  projectName: string;
  version: string;
  metrics: ReportMetrics;
  issues: AnalysisResult[];
}
