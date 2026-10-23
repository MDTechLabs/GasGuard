import { RuleViolation } from "../../scanner/interfaces/scanner.interface";

export interface FormattedViolation extends RuleViolation {
  severityIcon: string;
  formattedMessage: string;
}

export interface StorageSavings {
  unusedVariables: number;
  estimatedSavingsKb: number;
  monthlyLedgerRentSavings: number;
}

export interface AnalysisReport {
  source: string;
  analysisTime: string;
  violations: FormattedViolation[];
  summary: string;
  storageSavings: StorageSavings;
  recommendations: string[];
}

/**
 * Severity levels used by policy-as-code evaluation.
 */
export type PolicySeverity = "critical" | "high" | "medium" | "low" | "info";

/**
 * A single policy condition set. A policy fails the build when any configured
 * condition is matched by one or more violations in the report.
 */
export interface PolicyRule {
  /** Human-readable identifier for the policy, used in evaluation output. */
  name: string;
  /** Fail when any violation has a severity at or above this level. */
  failOnSeverity?: PolicySeverity;
  /** Fail when a violation matches one of these rule identifiers. */
  ruleIds?: string[];
  /** Fail when a violation's source path matches one of these glob-style patterns. */
  paths?: string[];
  /** Fail when the total number of matching violations meets or exceeds this count. */
  maxFindings?: number;
}

/**
 * Top-level policy configuration document (e.g. loaded from a policy file).
 */
export interface PolicyConfig {
  version: 1;
  policies: PolicyRule[];
}

/**
 * Result of evaluating a single policy against an analysis report.
 */
export interface PolicyEvaluationResult {
  policy: string;
  passed: boolean;
  matchedViolations: FormattedViolation[];
  reasons: string[];
}

/**
 * Aggregate result of evaluating all policies in a configuration.
 */
export interface PolicyEvaluationReport {
  passed: boolean;
  results: PolicyEvaluationResult[];
}
