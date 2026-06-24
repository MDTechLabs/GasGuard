/**
 * Soroban Analysis Result Diffing Types
 * 
 * Defines types for comparing Soroban contract analysis results between scans.
 */

export interface SorobanAnalysisResult {
  ruleId: string;
  contractName: string;
  filePath: string;
  line: number;
  function?: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
  confidence: number;
  category: string;
}

export interface SorobanScanDiff {
  newIssues: SorobanAnalysisResult[];
  fixedIssues: SorobanAnalysisResult[];
  persistentIssues: SorobanAnalysisResult[];
  summary: {
    added: number;
    removed: number;
    unchanged: number;
    delta: number;
    bySeverity: {
      error: { added: number; removed: number };
      warning: { added: number; removed: number };
      info: { added: number; removed: number };
    };
    byCategory: Record<string, { added: number; removed: number }>;
  };
}

export interface SorobanDiffReportOptions {
  includePersistent?: boolean;
  groupBy?: 'contract' | 'rule' | 'severity' | 'category';
  sortBy?: 'severity' | 'confidence' | 'contract';
}
