/**
 * Secret detection false-positive suppression (#1175).
 *
 * A credential detector that fires on documentation, fixtures and placeholder
 * values trains reviewers to ignore it. Suppression is therefore explicit and
 * auditable: each suppressed match names the rule that suppressed it, and an
 * inline `gasguard:allow-secret` marker lets a repository suppress a single
 * line without disabling the detector for a whole path.
 *
 * Matched values are never copied into a suppression result — only the rule id
 * and the location travel with the decision.
 */

export interface SuppressionInput {
  /** Detected literal (used for matching only, never returned). */
  value: string;
  /** Repository-relative file path. */
  filePath: string;
  /** Full line the literal was found on. */
  line: string;
}

export interface SuppressionRule {
  id: string;
  reason: string;
  test: (input: SuppressionInput) => boolean;
}

export interface SuppressionDecision {
  suppressed: boolean;
  ruleId?: string;
  reason?: string;
}

const SUPPRESSIBLE_PATH_PATTERNS = [
  /(^|\/)(tests?|__tests__|fixtures?|examples?|mocks?)\//i,
  /\.(md|mdx|rst|txt)$/i,
  /(^|\/)docs?\//i,
  /\.env\.(example|sample|template)$/i,
];

const PLACEHOLDER_VALUE = /(example|placeholder|dummy|sample|changeme|your[-_]?|xxxx|redacted|notreal)/i;
const INLINE_ALLOWANCE = /gasguard:allow-secret/;

export const DEFAULT_SUPPRESSION_RULES: SuppressionRule[] = [
  {
    id: "inline-allowance",
    reason: "line carries an explicit gasguard:allow-secret marker",
    test: (input) => INLINE_ALLOWANCE.test(input.line),
  },
  {
    id: "documentation-path",
    reason: "path is documentation or an example fixture",
    test: (input) => SUPPRESSIBLE_PATH_PATTERNS.some((pattern) => pattern.test(input.filePath)),
  },
  {
    id: "placeholder-value",
    reason: "value is a recognised placeholder",
    test: (input) => PLACEHOLDER_VALUE.test(input.value),
  },
];

/** Decide whether one detection is a false positive. */
export function isSuppressedSecret(
  input: SuppressionInput,
  rules: readonly SuppressionRule[] = DEFAULT_SUPPRESSION_RULES,
): SuppressionDecision {
  if (!input || typeof input.filePath !== "string" || typeof input.line !== "string") {
    throw new TypeError("suppression input must include filePath and line");
  }

  for (const rule of rules) {
    if (rule.test(input)) {
      return { suppressed: true, ruleId: rule.id, reason: rule.reason };
    }
  }

  return { suppressed: false };
}

export interface SuppressionReport<T extends SuppressionInput & { id: string }> {
  kept: T[];
  suppressed: Array<{ id: string; ruleId: string; reason: string }>;
}

/** Split detections into kept and suppressed, preserving input order. */
export function filterSuppressedSecrets<T extends SuppressionInput & { id: string }>(
  detections: readonly T[],
  rules: readonly SuppressionRule[] = DEFAULT_SUPPRESSION_RULES,
): SuppressionReport<T> {
  const kept: T[] = [];
  const suppressed: SuppressionReport<T>["suppressed"] = [];

  for (const detection of detections) {
    const decision = isSuppressedSecret(detection, rules);
    if (decision.suppressed) {
      suppressed.push({
        id: detection.id,
        ruleId: decision.ruleId ?? "unknown",
        reason: decision.reason ?? "suppressed",
      });
    } else {
      kept.push(detection);
    }
  }

  return { kept, suppressed };
}
