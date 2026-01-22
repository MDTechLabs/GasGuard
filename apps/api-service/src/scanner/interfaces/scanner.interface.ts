export type ViolationSeverity = 'error' | 'warning' | 'info';

export interface RuleViolation {
  ruleName: string;
  description: string;
  severity: ViolationSeverity;
  lineNumber: number;
  columnNumber: number;
  variableName: string;
  suggestion: string;
}

export interface ScanResult {
  source: string;
  violations: RuleViolation[];
  scanTime: string;
  scanDurationMs: number;
  hasViolations: boolean;
  summary: {
    total: number;
    errors: number;
    warnings: number;
    info: number;
  };
}
