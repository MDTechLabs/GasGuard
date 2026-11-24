/**
 * Finding suppression expiry and justification enforcement (#1329).
 *
 * A suppression that never expires and never says why turns into permanent,
 * invisible risk. Every suppression must therefore carry a justification and an
 * expiry date, and an expired or malformed one stops suppressing: the finding
 * comes back and the reason is reported.
 *
 * The evaluation is pure. The clock is an input, so the same suppressions, the
 * same findings and the same `now` always give the same result.
 */

export interface FindingSuppression {
  /** Stable rule identifier the suppression applies to. */
  ruleId: string;
  /** Repository-relative path, or a prefix ending in `/`. */
  path: string;
  /** Why the finding is acceptable. Reviewed by a human, never executed. */
  justification: string;
  /** Who accepted the risk. */
  owner?: string;
  /** ISO-8601 date or timestamp after which the suppression stops applying. */
  expiresAt: string;
}

export interface SuppressionPolicy {
  /** Minimum trimmed justification length. */
  minJustificationLength: number;
  /** Longest allowed distance between `now` and `expiresAt`, in days. */
  maxLifetimeDays: number;
}

export const DEFAULT_SUPPRESSION_POLICY: SuppressionPolicy = {
  minJustificationLength: 20,
  maxLifetimeDays: 180,
};

export type SuppressionProblem =
  | "missing-rule-id"
  | "missing-path"
  | "missing-justification"
  | "justification-too-short"
  | "placeholder-justification"
  | "missing-expiry"
  | "invalid-expiry"
  | "expired"
  | "expiry-too-far";

export interface SuppressionVerdict {
  suppression: FindingSuppression;
  /** True only when the suppression has no problems. */
  active: boolean;
  problems: SuppressionProblem[];
}

export interface SuppressibleFinding {
  id: string;
  ruleId: string;
  filePath: string;
}

export interface SuppressionOutcome<T extends SuppressibleFinding> {
  /** Findings that remain, including those whose suppression is not valid. */
  kept: T[];
  suppressed: Array<{ id: string; ruleId: string; justification: string; expiresAt: string }>;
  /** Suppressions that did not apply, with the reasons, in input order. */
  rejected: SuppressionVerdict[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PLACEHOLDER_JUSTIFICATION =
  /^(n\/?a|none|todo|tbd|fixme|ignore|ignored|false positive|fp|wontfix|ok|test)\W*$/i;

function parseExpiry(value: string): number | undefined {
  // A bare date means the end of that UTC day, so "2026-12-31" is still valid on the 31st.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const time = Date.parse(dateOnly ? `${value}T23:59:59.999Z` : value);
  return Number.isNaN(time) ? undefined : time;
}

/** Check one suppression against the policy at a given instant. */
export function evaluateSuppression(
  suppression: FindingSuppression,
  now: Date,
  policy: SuppressionPolicy = DEFAULT_SUPPRESSION_POLICY,
): SuppressionVerdict {
  const problems: SuppressionProblem[] = [];
  const ruleId = suppression.ruleId?.trim() ?? "";
  const path = suppression.path?.trim() ?? "";
  const justification = suppression.justification?.trim() ?? "";
  const expiresAt = suppression.expiresAt?.trim() ?? "";

  if (!ruleId) problems.push("missing-rule-id");
  if (!path) problems.push("missing-path");

  if (!justification) {
    problems.push("missing-justification");
  } else if (PLACEHOLDER_JUSTIFICATION.test(justification)) {
    problems.push("placeholder-justification");
  } else if (justification.length < policy.minJustificationLength) {
    problems.push("justification-too-short");
  }

  if (!expiresAt) {
    problems.push("missing-expiry");
  } else {
    const expiry = parseExpiry(expiresAt);
    if (expiry === undefined) {
      problems.push("invalid-expiry");
    } else if (expiry < now.getTime()) {
      problems.push("expired");
    } else if (expiry - now.getTime() > policy.maxLifetimeDays * DAY_MS) {
      problems.push("expiry-too-far");
    }
  }

  return { suppression, active: problems.length === 0, problems };
}

function matchesPath(pattern: string, filePath: string): boolean {
  const normalised = pattern.trim();
  return normalised.endsWith("/") ? filePath.startsWith(normalised) : filePath === normalised;
}

/**
 * Apply suppressions to findings. Only suppressions that pass the policy hide a
 * finding; the rest are returned in `rejected` so the caller can report them.
 */
export function applySuppressions<T extends SuppressibleFinding>(
  findings: readonly T[],
  suppressions: readonly FindingSuppression[],
  now: Date,
  policy: SuppressionPolicy = DEFAULT_SUPPRESSION_POLICY,
): SuppressionOutcome<T> {
  const verdicts = suppressions.map((suppression) => evaluateSuppression(suppression, now, policy));
  const active = verdicts.filter((verdict) => verdict.active).map((verdict) => verdict.suppression);

  const kept: T[] = [];
  const suppressed: SuppressionOutcome<T>["suppressed"] = [];

  for (const finding of findings) {
    const match = active.find(
      (candidate) =>
        candidate.ruleId.trim() === finding.ruleId && matchesPath(candidate.path, finding.filePath),
    );
    if (match) {
      suppressed.push({
        id: finding.id,
        ruleId: finding.ruleId,
        justification: match.justification.trim(),
        expiresAt: match.expiresAt.trim(),
      });
    } else {
      kept.push(finding);
    }
  }

  return { kept, suppressed, rejected: verdicts.filter((verdict) => !verdict.active) };
}
