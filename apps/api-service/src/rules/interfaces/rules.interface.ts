export type RuleSeverity = "error" | "warning" | "info";
export type RuleCategory =
  | "storage-optimization"
  | "gas-optimization"
  | "security"
  | "best-practices";

export interface RuleDefinition {
  name: string;
  description: string;
  severity: RuleSeverity;
  category: RuleCategory;
  enabled: boolean;
  documentationUrl?: string;
}

/**
 * A single finding produced by rule evaluation.
 */
export interface RuleFinding {
  rule: string;
  severity: RuleSeverity;
  category: RuleCategory;
  path: string;
  message: string;
}

/**
 * Policy-as-code configuration. A policy fails the build when any of the
 * configured thresholds are exceeded.
 */
export interface PolicyConfig {
  /** Human-readable name for the policy, used in reports. */
  name: string;
  /** Optional description of what the policy enforces. */
  description?: string;
  /** Whether this policy is active. Defaults to true when omitted. */
  enabled?: boolean;
  /**
   * Maximum number of findings allowed per severity level. A value of
   * `undefined` means no limit for that severity. A limit of 0 fails on any
   * finding of that severity.
   */
  maxFindingsBySeverity?: Partial<Record<RuleSeverity, number>>;
  /** Maximum total number of findings across all severities. */
  maxTotalFindings?: number;
  /** Rule names that must cause the build to fail when triggered. */
  failOnRules?: string[];
  /** Rule names to ignore when evaluating this policy. */
  ignoreRules?: string[];
  /**
   * Glob-style path patterns. Findings whose path matches any of these
   * patterns are excluded from evaluation.
   */
  ignorePaths?: string[];
  /**
   * Glob-style path patterns. When set, only findings whose path matches at
   * least one pattern are considered.
   */
  includePaths?: string[];
}

/**
 * Top-level policy file structure (e.g. `gasguard.policy.json`).
 */
export interface PolicyFile {
  version: 1;
  policies: PolicyConfig[];
}

/**
 * Result of evaluating a single policy against a set of findings.
 */
export interface PolicyViolation {
  policy: string;
  reason:
    | "severity-threshold"
    | "total-threshold"
    | "rule-triggered";
  detail: string;
  findings: RuleFinding[];
}

/**
 * Aggregate result of evaluating all policies.
 */
export interface PolicyEvaluationResult {
  passed: boolean;
  violations: PolicyViolation[];
  evaluatedAt: string;
}
