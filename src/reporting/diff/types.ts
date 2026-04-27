import { AnalysisResult } from '../../analysis/filter/analysis-filter';

export interface ScanDiff {
  newIssues: AnalysisResult[];
  fixedIssues: AnalysisResult[];
  persistentIssues: AnalysisResult[];
  summary: {
    added: number;
    removed: number;
    unchanged: number;
    delta: number; // positive means more issues, negative means fewer
  };
}

export interface DiffReportOptions {
  includePersistent?: boolean;
  groupBy?: 'file' | 'rule';
}
