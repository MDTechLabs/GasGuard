/**
 * Policy document types for the GasGuard policy validation command (issue #1064).
 *
 * Severity values come from the project config vocabulary in
 * `src/config/config.interface.ts`. A policy `minSeverity` is a build gate,
 * not a report filter: it is the lowest severity that fails a build.
 */

import {
  SeverityThreshold,
  VALID_SEVERITIES,
} from "../config/config.interface";

export const POLICY_SCHEMA_VERSION = "1";

export const POLICY_MODES = ["enforce", "warn", "disabled"] as const;
export type PolicyMode = (typeof POLICY_MODES)[number];

export type PolicySeverity = SeverityThreshold;

export const POLICY_SEVERITIES: readonly PolicySeverity[] = VALID_SEVERITIES;

/** Fail-closed defaults applied when a valid document omits the field. */
export const SECURE_DEFAULTS = {
  mode: "enforce" as PolicyMode,
  minSeverity: "high" as PolicySeverity,
};

export const POLICY_LIMITS = {
  maxBytes: 256 * 1024,
  maxNameLength: 64,
  maxDescriptionLength: 500,
  maxListLength: 200,
  maxPathLength: 256,
  maxRuleIdLength: 64,
  maxFindings: 1_000_000,
};

export interface PolicyIssue {
  path: string;
  message: string;
  code: string;
}

export interface NormalizedPolicyGates {
  minSeverity: PolicySeverity;
  ruleIds: string[];
  paths: string[];
  maxFindings?: number;
  maxFindingsBySeverity: Partial<Record<PolicySeverity, number>>;
}

export interface NormalizedPolicy {
  schemaVersion: typeof POLICY_SCHEMA_VERSION;
  name: string;
  version: string;
  description?: string;
  mode: PolicyMode;
  gates: NormalizedPolicyGates;
  scope: {
    include: string[];
    exclude: string[];
  };
}

export interface PolicyValidationResult {
  valid: boolean;
  errors: PolicyIssue[];
  warnings: PolicyIssue[];
  defaultsApplied: string[];
  policy?: NormalizedPolicy;
}

export interface PolicyValidationMetrics {
  outcome: "pass" | "fail";
  errorCount: number;
  warningCount: number;
  durationMs: number;
  strict: boolean;
  bytesRead?: number;
}

export interface PolicyCommandReport {
  valid: boolean;
  file: string;
  errors: PolicyIssue[];
  warnings: PolicyIssue[];
  defaultsApplied: string[];
  policy?: NormalizedPolicy;
  metrics: PolicyValidationMetrics;
  correlationId: string;
}
