/**
 * Types and interfaces for the Soroban Deployment Risk Reporter.
 *
 * Generates human-readable, explainable reports, GitHub PR comments,
 * and structured JSON outputs from deployment risk assessments.
 */

import { DeploymentRiskScore, RiskLevel } from '../../../analyzers/soroban/risk/types';

export type ReportFormat = 'markdown' | 'json' | 'pr-comment' | 'cli-summary';

export interface RiskReportOptions {
  /** Desired output format. Defaults to 'markdown'. */
  format?: ReportFormat;
  /** Include actionable remediation checklist. Defaults to true. */
  includeRemediation?: boolean;
  /** Include deployment pre-flight verification checklist. Defaults to true. */
  includeChecklist?: boolean;
  /** Maximum number of findings displayed per category before collapsing. Defaults to 5. */
  maxFindingsPerCategory?: number;
  /** Total findings threshold beyond which table is wrapped in a collapsible block in PR comments. */
  collapseDetailsThreshold?: number;
  /** Optional contract name or identifier for headers. */
  contractName?: string;
  /** Target Stellar / Soroban network for deployment context. */
  targetNetwork?: 'testnet' | 'mainnet' | 'futurenet' | 'standalone';
}

export interface FormattedRiskReport {
  format: ReportFormat;
  content: string;
  summary: string;
  riskLevel: RiskLevel;
  compositeScore: number;
  readyForDeployment: boolean;
  blockers: string[];
}
