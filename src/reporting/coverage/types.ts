/**
 * Analyzer Coverage Reporting Types
 *
 * Types for reporting on analyzer coverage metrics and uncovered patterns.
 */

import { CoverageMetrics } from "../../analysis/coverage/coverage-analyzer";

export interface CoverageReportData {
  projectName: string;
  version: string;
  timestamp: Date;
  coverage: CoverageMetrics;
  filesCovered: number;
  totalFiles: number;
  analysisTimeMs: number;
  rulesCoverage?: RuleCoverageData[];
}

export interface RuleCoverageData {
  ruleId: string;
  ruleName: string;
  nodesAnalyzed: number;
  nodeTypes: string[];
  filesAffected: string[];
}

export interface CoverageReportOptions {
  format?: "text" | "json" | "html" | "markdown";
  includeUncoveredDetails?: boolean;
  includeRuleBreakdown?: boolean;
  thresholdPercent?: number;
}

export interface CoverageThreshold {
  minCoveragePercent: number;
  failOnThreshold: boolean;
}

export interface CoverageReportResult {
  success: boolean;
  coveragePercent: number;
  thresholdMet: boolean;
  reportPath?: string;
  summary: string;
}
