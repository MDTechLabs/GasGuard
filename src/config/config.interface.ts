/**
 * Project-level GasGuard configuration (`.gasguardrc`).
 *
 * Lets a project customize active rules, ignored paths, and severity gating
 * without appending long flags to every CLI invocation.
 */

export type SeverityThreshold = "critical" | "high" | "medium" | "low" | "info";

export interface GasGuardConfig {
  /** Rule ids that should be disabled for this project. */
  ignoreRules: string[];
  /** Paths that should be scanned. Defaults to the project root. */
  includePaths: string[];
  /** Paths that should be skipped during AST parsing (e.g. legacy contracts). */
  excludePaths: string[];
  /** Minimum severity that is reported. */
  severityThreshold: SeverityThreshold;
}

export const VALID_SEVERITIES: readonly SeverityThreshold[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

export const DEFAULT_CONFIG: GasGuardConfig = {
  ignoreRules: [],
  includePaths: ["."],
  excludePaths: [],
  severityThreshold: "info",
};
