/**
 * Types and interfaces for the Soroban Deployment Risk Score Analyzer.
 *
 * Consolidates security findings, resource findings, and deployment findings
 * into a normalized, explainable 0–100 deployment risk score.
 */

export type RiskCategory = 'security' | 'resource' | 'deployment';

export type RiskSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type RiskLevel = 'critical' | 'high' | 'medium' | 'low' | 'safe';

/** Configurable category and severity weight parameters. */
export interface RiskWeightConfig {
  /** Relative weights for each category. Must sum to 1.0 (or will be normalized). */
  categories: Record<RiskCategory, number>;
  /** Base point scores per severity level. */
  severities: Record<RiskSeverity, number>;
  /** Score threshold boundaries for risk level bands. */
  levelThresholds: {
    critical: number; // e.g. >= 80
    high: number;     // e.g. >= 60
    medium: number;   // e.g. >= 35
    low: number;      // e.g. >= 15
  };
  /** Maximum allowable risk score for automated deployment pass (default: 40). */
  maxAcceptableScore?: number;
  /** Optional rule-specific weight multipliers (1.0 default). */
  customRuleWeights?: Record<string, number>;
}

/** Individual finding input/output for risk assessment. */
export interface DeploymentRiskFinding {
  id: string;
  ruleId: string;
  category: RiskCategory;
  severity: RiskSeverity;
  message: string;
  description?: string;
  suggestion?: string;
  line?: number;
  file?: string;
  weight?: number;
  metadata?: Record<string, any>;
}

/** Aggregated risk summary for a single category. */
export interface CategoryRiskSummary {
  category: RiskCategory;
  /** Normalized category score (0–100). */
  score: number;
  /** Applied category weight (0–1). */
  weight: number;
  /** Score contribution to the composite risk score (score * weight). */
  weightedScore: number;
  /** Total findings in this category. */
  findingCount: number;
  /** Count breakdown per severity. */
  severityCounts: Record<RiskSeverity, number>;
  /** Highest severity level detected in this category, or null if empty. */
  highestSeverity: RiskSeverity | null;
  /** Top contributing findings in this category. */
  topFindings: DeploymentRiskFinding[];
  /** Explanatory summary text for this category. */
  summary: string;
}

/** Consolidated deployment risk assessment result. */
export interface DeploymentRiskScore {
  /** Overall composite risk score (0–100). Higher means greater risk. */
  compositeScore: number;
  /** Categorical risk level derived from compositeScore. */
  riskLevel: RiskLevel;
  /** Whether the contract is cleared for deployment based on score and blockers. */
  readyForDeployment: boolean;
  /** Critical issues or threshold violations blocking deployment. */
  blockers: string[];
  /** Breakdown by category (security, resource, deployment). */
  categoryBreakdown: Record<RiskCategory, CategoryRiskSummary>;
  /** All evaluated findings. */
  findings: DeploymentRiskFinding[];
  /** Weights configuration used for evaluation. */
  weights: RiskWeightConfig;
  /** Human-readable explanation of how the score was derived. */
  rationale: string;
  /** Top primary risk drivers contributing to the score. */
  primaryRiskDrivers: string[];
  /** Ordered list of prioritized remediation actions. */
  remediationSuggestions: string[];
  /** ISO timestamp when assessment was generated. */
  analyzedAt: string;
  /** Optional contract file path or name. */
  contractPath?: string;
  /** Metadata associated with the assessment. */
  metadata?: Record<string, any>;
}

/** Static pattern definition for direct source scanning. */
export interface DeploymentRiskPattern {
  id: string;
  category: RiskCategory;
  name: string;
  description: string;
  pattern: RegExp;
  severity: RiskSeverity;
  riskWeight: number;
  suggestion: string;
  isMultiLine?: boolean;
}
