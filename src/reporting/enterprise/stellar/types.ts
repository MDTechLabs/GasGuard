import { AnalysisResult } from "../../../analysis/filter/analysis-filter";

export type EnterpriseExportFormat = "json" | "csv" | "markdown";

export type EnterpriseSeverity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "info";

export type ComplianceStatus = "pass" | "review" | "fail";

export interface StellarEnterpriseReportOptions {
  projectName: string;
  scanPath: string;
  version?: string;
  generatedBy?: string;
  generatedAt?: Date;
  durationMs?: number;
  frameworks?: string[];
}

export interface StellarEnterpriseFinding extends AnalysisResult {
  severity: EnterpriseSeverity;
  category: string;
  impact: string;
  recommendation: string;
  complianceAreas: string[];
  functionName?: string;
}

export interface FunctionRiskSummary {
  functionName: string;
  overallScore: number;
  riskLevel: 'critical' | 'high' | 'medium' | 'low' | 'minimal';
}

export interface StellarComplianceControl {
  id: string;
  title: string;
  status: ComplianceStatus;
  score: number;
  findingsCount: number;
  rationale: string;
}

export interface StellarComplianceSummary {
  status: ComplianceStatus;
  score: number;
  readyForAudit: boolean;
  controls: StellarComplianceControl[];
  summary: string;
}

export interface StellarEnterpriseMetadata {
  projectName: string;
  version: string;
  scanPath: string;
  generatedBy: string;
  generatedAt: string;
  frameworks: string[];
}

export interface StellarEnterpriseSummary {
  totalFindings: number;
  totalFiles: number;
  uniqueRules: number;
  averageConfidence: number;
  criticalFindings: number;
  highFindings: number;
  mediumFindings: number;
  lowFindings: number;
  infoFindings: number;
  affectedFiles: string[];
  estimatedRemediationMinutes: number;
}

export interface StellarEnterpriseReport {
  metadata: StellarEnterpriseMetadata;
  summary: StellarEnterpriseSummary;
  compliance: StellarComplianceSummary;
  findings: StellarEnterpriseFinding[];
  functionRiskSummary?: FunctionRiskSummary[];
  exportFormats: EnterpriseExportFormat[];
}
