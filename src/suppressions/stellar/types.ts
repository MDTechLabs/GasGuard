/**
 * Soroban Rule Suppression Framework — Types
 *
 * Defines the shapes for inline suppressions, configuration-based suppressions,
 * and suppression records with reasons.
 *
 * @see Issue #476 — Implement Soroban Rule Suppression Framework
 */

// ─── Suppression Source ───────────────────────────────────────────────────────

/** How the suppression was declared. */
export type SuppressionSource = 'inline' | 'config';

// ─── Inline Suppression ───────────────────────────────────────────────────────

/**
 * Inline suppression parsed from a source annotation.
 *
 * Example annotation in Soroban contract source:
 *   // gasguard-suppress: GG001 -- acceptable in single-owner contract
 */
export interface InlineSuppression {
  source: 'inline';
  /** The rule ID being suppressed (e.g. "GG001"). */
  ruleId: string;
  /** File path where the annotation was found. */
  filePath: string;
  /** Line number of the suppression annotation (1-indexed). */
  line: number;
  /** Human-readable reason provided by the developer. */
  reason: string;
}

// ─── Config Suppression ───────────────────────────────────────────────────────

/**
 * Config-based suppression declared in gasguard.config.json or equivalent.
 *
 * Example config entry:
 *   { "ruleId": "GG002", "scope": "global", "reason": "Not applicable for this contract type" }
 */
export interface ConfigSuppression {
  source: 'config';
  /** The rule ID being suppressed. */
  ruleId: string;
  /**
   * Scope of the suppression.
   * - "global": applies to all findings for this rule across the project.
   * - A file glob (e.g. "contracts/legacy/**"): applies only to matching files.
   */
  scope: 'global' | string;
  /** Human-readable reason. */
  reason: string;
}

/** Union type covering both suppression kinds. */
export type Suppression = InlineSuppression | ConfigSuppression;

// ─── Finding ─────────────────────────────────────────────────────────────────

/** A rule finding produced by the analyser. */
export interface Finding {
  /** Rule ID that produced this finding. */
  ruleId: string;
  /** Short description of the finding. */
  message: string;
  /** File path where the finding was detected. */
  filePath: string;
  /** Line number within the file (1-indexed). */
  line: number;
  /** Severity level. */
  severity: 'high' | 'medium' | 'low';
}

// ─── Suppression Record ───────────────────────────────────────────────────────

/** A finding that was actively suppressed, with a record of why. */
export interface SuppressionRecord {
  finding: Finding;
  suppression: Suppression;
  /** When the suppression was applied (ISO string). */
  suppressedAt: string;
}

// ─── Filter Result ────────────────────────────────────────────────────────────

/** Output of the suppression engine's filter operation. */
export interface SuppressionFilterResult {
  /** Findings that were NOT suppressed (should appear in reports). */
  active: Finding[];
  /** Findings that were suppressed, with their suppression records. */
  suppressed: SuppressionRecord[];
}

// ─── Engine Config ────────────────────────────────────────────────────────────

/** Configuration for RuleSuppressionFramework. */
export interface SuppressionFrameworkConfig {
  /**
   * Inline suppression annotation prefix.
   * Default: "gasguard-suppress:"
   */
  inlineAnnotationPrefix?: string;
  /**
   * If true, log a warning when a suppression is applied.
   * Useful for audit trails during CI.
   * Default: false
   */
  warnOnSuppression?: boolean;
  /** Callback invoked every time a finding is suppressed. */
  onSuppressed?: (record: SuppressionRecord) => void;
}
