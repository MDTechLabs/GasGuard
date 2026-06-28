import { Finding, Severity } from "@engine/core";

export interface SorobanFindingCorrelationOptions {
  generatedAt?: Date;
  minimumGroupSize?: number;
}

export interface SorobanCorrelatedFinding {
  finding: Finding;
  signals: string[];
}

export interface SorobanFindingCorrelationGroup {
  id: string;
  title: string;
  findingCount: number;
  highestSeverity: Severity;
  affectedFiles: string[];
  affectedFunctions: string[];
  ruleIds: string[];
  sharedSignals: string[];
  findings: SorobanCorrelatedFinding[];
  recommendation: string;
}

export interface SorobanFindingCorrelationSummary {
  totalFindings: number;
  correlatedGroups: number;
  standaloneFindings: number;
  affectedFiles: string[];
  highestSeverity: Severity | null;
}

export interface SorobanFindingCorrelationReport {
  generatedAt: string;
  summary: SorobanFindingCorrelationSummary;
  groups: SorobanFindingCorrelationGroup[];
  standaloneFindings: Finding[];
}
