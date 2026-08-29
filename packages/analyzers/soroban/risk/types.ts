/**
 * Soroban Deployment Risk Scoring — Shared Types
 *
 * Defines the data contracts used across the risk aggregation pipeline:
 * raw finding adapters, configurable weighting, and the final scored output.
 */

// ─── Severity ──────────────────────────────────────────────────────────────

export type RiskSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

// ─── Normalized finding (input to scorer) ──────────────────────────────────

/**
 * A single finding from any upstream analyzer, normalized into a common shape
 * so the scorer doesn't need to know each analyzer's internal format.
 */
export interface NormalizedFinding {
  /** Stable rule identifier, e.g. "SOROBAN-STOR-01" */
  ruleId: string;
  severity: RiskSeverity;
  /** Human-readable description */
  message: string;
  /** Which high-level category this finding belongs to */
  category: FindingCategory;
  /** Optional: number of gas units this issue wastes / costs */
  estimatedGasCost?: number;
}

export type FindingCategory =
  | 'security'    // auth, access-control, reentrancy …
  | 'resource'    // cpu, memory, storage rent …
  | 'deployment'  // wasm size, host-import frequency, stack bloat …
  | 'optimization'; // redundant reads/writes, loop patterns …

// ─── Weighting ─────────────────────────────────────────────────────────────

/**
 * Configurable weight for each finding category (all values > 0).
 * Higher weight → greater impact on the overall score.
 *
 * Default values keep security findings dominant over resource/deployment.
 */
export interface DeploymentRiskWeights {
  security: number;
  resource: number;
  deployment: number;
  optimization: number;
}

export const DEFAULT_WEIGHTS: DeploymentRiskWeights = {
  security: 10,
  resource: 6,
  deployment: 7,
  optimization: 4,
};

/** Per-severity point multipliers applied before category weighting. */
export interface SeverityMultipliers {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export const DEFAULT_SEVERITY_MULTIPLIERS: SeverityMultipliers = {
  critical: 10,
  high: 7,
  medium: 4,
  low: 2,
  info: 1,
};

// ─── Score output ──────────────────────────────────────────────────────────

export type RiskLevel = 'critical' | 'high' | 'medium' | 'low' | 'minimal';
export type RiskGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface CategoryScoreBreakdown {
  /** Weighted raw points accumulated for this category */
  rawPoints: number;
  /** Count of findings in this category */
  count: number;
  /** Contribution to the overall 0–100 score (informational) */
  contribution: number;
}

/**
 * Full output of the `SorobanDeploymentRiskScorer`.
 */
export interface DeploymentRiskScore {
  /** Normalized overall score: 0 (safe) → 100 (critical) */
  overallScore: number;
  /** Letter grade summarising deployment health */
  grade: RiskGrade;
  riskLevel: RiskLevel;

  /** Per-category breakdown so the report can explain the score */
  categoryBreakdown: Record<FindingCategory, CategoryScoreBreakdown>;

  /** Severity counts across all findings */
  severityCounts: Record<RiskSeverity, number>;

  /** Up to 5 most impactful findings, sorted by score contribution */
  topFindings: NormalizedFinding[];

  /** Weighted total of estimatedGasCost across all findings */
  totalGasCost: number;

  /** Human-readable bullets explaining the score */
  explanation: string[];

  /** Actionable recommendations */
  recommendations: string[];

  meta: {
    totalFindings: number;
    scoredAt: string;
    /** Weights used during this scoring run */
    weightsUsed: DeploymentRiskWeights;
  };
}
