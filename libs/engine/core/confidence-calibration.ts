/**
 * Rule-level confidence calibration.
 *
 * Analyzer rules differ widely in how often their findings turn out to be
 * real. This module turns reviewed outcomes (true / false positive verdicts)
 * into a per-rule track record and uses it to attach a calibrated confidence,
 * and a coarse band, to every finding.
 *
 * Model
 * ─────
 * For a rule with `tp` true positives and `fp` false positives, a prior
 * confidence `p` and prior strength `s` (pseudo-observations), the empirical
 * rate is the smoothed estimate
 *
 *     q = (tp + p·s) / (tp + fp + s)
 *
 * A finding that carries its own raw confidence `r` (in `metadata.confidence`)
 * is shifted by how far the rule's rate is from its prior, in log-odds space:
 *
 *     confidence = sigmoid(logit(r) + logit(q) - logit(p))
 *
 * Without a raw confidence `r = p`, so the result is exactly `q`. Rules with
 * fewer than `minSamples` reviewed outcomes are left uncalibrated (raw
 * confidence, else the prior) so a handful of reviews cannot swing results.
 *
 * Design
 * ──────
 * - Pure: no I/O, clock or module state. The same findings, profiles and
 *   config always give the same output, and a call is safe to retry.
 * - Tenant-safe: the module only sees the outcomes and profiles passed in.
 *   Build profiles from a single tenant's reviewed outcomes.
 * - Rule-pack aware: when `rulePackVersion` is configured, profiles and
 *   outcomes recorded against a different version are ignored and reported,
 *   because a rule's behaviour can change between versions.
 * - Backward compatible: with no config, findings only gain confidence
 *   metadata. Nothing is suppressed unless `minConfidence` is set.
 * - Idempotent: re-calibrating already calibrated findings gives the same result.
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export const CALIBRATION_SCHEMA_VERSION = 1;
export const DEFAULT_PRIOR_CONFIDENCE = 0.5;
export const DEFAULT_PRIOR_STRENGTH = 10;
export const DEFAULT_MIN_SAMPLES = 5;
export const DEFAULT_BAND_THRESHOLDS: ConfidenceBandThresholds = { high: 0.8, medium: 0.5 };

export type ConfidenceBand = "high" | "medium" | "low";

export type ConfidenceSource =
  /** Shifted by the rule's reviewed track record. */
  | "calibrated"
  /** The finding's own confidence; the rule has too little history. */
  | "raw"
  /** No raw confidence and too little history: the rule's prior. */
  | "prior"
  /** Pinned by `ruleOverrides`. */
  | "override";

export interface ConfidenceBandThresholds {
  /** Confidence at or above this is `high`. */
  high: number;
  /** Confidence at or above this (and below `high`) is `medium`. */
  medium: number;
}

export interface RuleCalibrationProfile {
  ruleId: string;
  truePositives: number;
  falsePositives: number;
  /** Starting belief for this rule. Default: `CalibrationConfig.defaultPrior`. */
  priorConfidence?: number;
  /** Prior weight in pseudo-observations. Default: `CalibrationConfig.priorStrength`. */
  priorStrength?: number;
  /** Rule-pack version the outcomes were recorded against. */
  rulePackVersion?: string;
}

export interface RuleOverride {
  /** Pins the confidence of every finding of this rule, skipping calibration. */
  confidence?: number;
  /** Per-rule suppression threshold; takes precedence over `minConfidence`. */
  minConfidence?: number;
}

export interface CalibrationConfig {
  profiles?: RuleCalibrationProfile[];
  ruleOverrides?: Record<string, RuleOverride>;
  /** Version of the rule pack being run. Mismatching profiles are ignored. */
  rulePackVersion?: string;
  /** Prior for rules without their own. Default 0.5. */
  defaultPrior?: number;
  /** Prior strength for rules without their own. Default 10. */
  priorStrength?: number;
  /** Reviewed outcomes needed before a rule is calibrated. Default 5. */
  minSamples?: number;
  /** Findings below this confidence are suppressed. Default 0 (suppress nothing). */
  minConfidence?: number;
  bandThresholds?: ConfidenceBandThresholds;
}

export interface CalibratableFinding {
  ruleId: string;
  metadata?: Record<string, unknown>;
}

export interface ConfidenceMetadata {
  /** Calibrated confidence in [0, 1], rounded to 4 decimals. */
  confidence: number;
  confidenceBand: ConfidenceBand;
  confidenceSource: ConfidenceSource;
  /** Reviewed outcomes behind the rule's calibration (0 when none). */
  calibrationSamples: number;
  /** The finding's confidence before calibration, when it had one. */
  rawConfidence?: number;
}

export type CalibratedFinding<T extends CalibratableFinding> = Omit<T, "metadata"> & {
  metadata: Record<string, unknown> & ConfidenceMetadata;
};

export type CalibrationIssueCode =
  | "INVALID_PROFILE"
  | "DUPLICATE_PROFILE"
  | "STALE_PROFILE"
  | "INVALID_CONFIG"
  | "INVALID_CONFIDENCE"
  | "MISSING_RULE_ID"
  | "INVALID_OUTCOME";

export interface CalibrationIssue {
  code: CalibrationIssueCode;
  message: string;
  ruleId?: string;
}

export interface RuleCalibrationSummary {
  ruleId: string;
  findings: number;
  suppressed: number;
  source: ConfidenceSource;
  meanConfidence: number;
}

export interface CalibrationResult<T extends CalibratableFinding> {
  schemaVersion: number;
  /** Findings that met the confidence threshold, in input order. */
  findings: Array<CalibratedFinding<T>>;
  /** Findings below the threshold, in input order, still carrying their confidence. */
  suppressed: Array<CalibratedFinding<T>>;
  rules: RuleCalibrationSummary[];
  issues: CalibrationIssue[];
  counts: {
    received: number;
    kept: number;
    suppressed: number;
    calibrated: number;
    uncalibrated: number;
  };
}

export type OutcomeVerdict = "true_positive" | "false_positive" | "ignored";

export interface ReviewedOutcome {
  ruleId: string;
  verdict: OutcomeVerdict;
  rulePackVersion?: string;
}

export interface BuildProfilesOptions {
  /** Only outcomes recorded against this version are counted. */
  rulePackVersion?: string;
  priorConfidence?: number;
  priorStrength?: number;
}

export interface BuildProfilesResult {
  /** Sorted by `ruleId`. */
  profiles: RuleCalibrationProfile[];
  issues: CalibrationIssue[];
  counts: { received: number; counted: number; ignored: number; otherVersion: number; invalid: number };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Maps a confidence to its band. Invalid thresholds fall back to the defaults. */
export function confidenceBand(
  confidence: number,
  thresholds: ConfidenceBandThresholds = DEFAULT_BAND_THRESHOLDS,
): ConfidenceBand {
  const t = validThresholds(thresholds) ? thresholds : DEFAULT_BAND_THRESHOLDS;
  return confidence >= t.high ? "high" : confidence >= t.medium ? "medium" : "low";
}

/**
 * Aggregates reviewed finding outcomes into one profile per rule.
 * `ignored` verdicts and outcomes from another rule-pack version are counted
 * in `counts` but do not affect a profile.
 */
export function buildCalibrationProfiles(
  outcomes: ReviewedOutcome[],
  options: BuildProfilesOptions = {},
): BuildProfilesResult {
  const issues: CalibrationIssue[] = [];
  const counts = { received: outcomes.length, counted: 0, ignored: 0, otherVersion: 0, invalid: 0 };
  const byRule = new Map<string, { tp: number; fp: number }>();

  for (const outcome of outcomes) {
    const ruleId = typeof outcome?.ruleId === "string" ? outcome.ruleId.trim() : "";
    if (ruleId === "" || !isVerdict(outcome.verdict)) {
      counts.invalid++;
      issues.push({
        code: "INVALID_OUTCOME",
        ruleId: ruleId || undefined,
        message: `Outcome needs a ruleId and a verdict of true_positive, false_positive or ignored.`,
      });
      continue;
    }
    if (
      options.rulePackVersion !== undefined &&
      outcome.rulePackVersion !== options.rulePackVersion
    ) {
      counts.otherVersion++;
      continue;
    }
    if (outcome.verdict === "ignored") {
      counts.ignored++;
      continue;
    }
    const entry = byRule.get(ruleId) ?? { tp: 0, fp: 0 };
    if (outcome.verdict === "true_positive") entry.tp++;
    else entry.fp++;
    byRule.set(ruleId, entry);
    counts.counted++;
  }

  const profiles = [...byRule.entries()]
    .sort((a, b) => cmp(a[0], b[0]))
    .map(([ruleId, { tp, fp }]): RuleCalibrationProfile => ({
      ruleId,
      truePositives: tp,
      falsePositives: fp,
      ...(options.priorConfidence !== undefined ? { priorConfidence: options.priorConfidence } : {}),
      ...(options.priorStrength !== undefined ? { priorStrength: options.priorStrength } : {}),
      ...(options.rulePackVersion !== undefined ? { rulePackVersion: options.rulePackVersion } : {}),
    }));

  return { profiles, issues, counts };
}

/**
 * Attaches a calibrated confidence and band to each finding. Input findings
 * are not mutated. Invalid configuration or profiles never throw: the bad part
 * is ignored, reported in `issues`, and defaults apply.
 */
export function calibrateFindings<T extends CalibratableFinding>(
  findings: T[],
  config: CalibrationConfig = {},
): CalibrationResult<T> {
  const issues: CalibrationIssue[] = [];
  const settings = resolveSettings(config, issues);
  const profiles = indexProfiles(config.profiles ?? [], settings, config.rulePackVersion, issues);

  const kept: Array<CalibratedFinding<T>> = [];
  const suppressed: Array<CalibratedFinding<T>> = [];
  const perRule = new Map<
    string,
    { findings: number; suppressed: number; total: number; source: ConfidenceSource }
  >();
  const reportedBadConfidence = new Set<string>();
  let calibrated = 0;

  for (const finding of findings) {
    const ruleId = typeof finding?.ruleId === "string" ? finding.ruleId.trim() : "";
    if (ruleId === "") {
      issues.push({
        code: "MISSING_RULE_ID",
        message: "Finding has no ruleId; the default prior was used.",
      });
    }

    const metadata = (finding.metadata ?? {}) as Record<string, unknown>;
    // A finding that was already calibrated keeps its original raw value, so
    // calibrating twice does not shift twice.
    const rawInput = "confidenceSource" in metadata ? metadata.rawConfidence : metadata.confidence;
    const raw = validProbability(rawInput) ? rawInput : undefined;
    if (rawInput !== undefined && raw === undefined && !reportedBadConfidence.has(ruleId)) {
      reportedBadConfidence.add(ruleId);
      issues.push({
        code: "INVALID_CONFIDENCE",
        ruleId: ruleId || undefined,
        message: `metadata.confidence must be a number in [0, 1]; ignored for this rule's findings with invalid values.`,
      });
    }

    const override = config.ruleOverrides?.[ruleId];
    const profile = profiles.get(ruleId);
    const prior = profile?.prior ?? settings.defaultPrior;
    const samples = profile?.samples ?? 0;

    let confidence: number;
    let source: ConfidenceSource;
    if (override && validProbability(override.confidence)) {
      confidence = override.confidence;
      source = "override";
    } else if (profile && samples >= settings.minSamples) {
      const rate = (profile.truePositives + prior * profile.strength) / (samples + profile.strength);
      confidence = sigmoid(logit(raw ?? prior) + logit(rate) - logit(prior));
      source = "calibrated";
    } else if (raw !== undefined) {
      confidence = raw;
      source = "raw";
    } else {
      confidence = prior;
      source = "prior";
    }
    confidence = round4(confidence);
    if (source === "calibrated") calibrated++;

    const out = {
      ...finding,
      metadata: {
        ...metadata,
        confidence,
        confidenceBand: confidenceBand(confidence, settings.bands),
        confidenceSource: source,
        calibrationSamples: samples,
        ...(raw !== undefined ? { rawConfidence: raw } : {}),
      },
    } as unknown as CalibratedFinding<T>;
    if (raw === undefined) delete (out.metadata as Record<string, unknown>).rawConfidence;

    const overrideMin = override?.minConfidence;
    const threshold = validProbability(overrideMin) ? overrideMin : settings.minConfidence;
    const isSuppressed = confidence < threshold;
    (isSuppressed ? suppressed : kept).push(out);

    const entry = perRule.get(ruleId) ?? { findings: 0, suppressed: 0, total: 0, source };
    entry.findings++;
    entry.total += confidence;
    if (isSuppressed) entry.suppressed++;
    perRule.set(ruleId, entry);
  }

  const rules = [...perRule.entries()]
    .sort((a, b) => cmp(a[0], b[0]))
    .map(([ruleId, e]): RuleCalibrationSummary => ({
      ruleId,
      findings: e.findings,
      suppressed: e.suppressed,
      source: e.source,
      meanConfidence: round4(e.total / e.findings),
    }));

  issues.sort((a, b) => cmp(a.code, b.code) || cmp(a.ruleId ?? "", b.ruleId ?? "") || cmp(a.message, b.message));

  return {
    schemaVersion: CALIBRATION_SCHEMA_VERSION,
    findings: kept,
    suppressed,
    rules,
    issues,
    counts: {
      received: findings.length,
      kept: kept.length,
      suppressed: suppressed.length,
      calibrated,
      uncalibrated: findings.length - calibrated,
    },
  };
}

// ─── Internals ────────────────────────────────────────────────────────────────

interface Settings {
  defaultPrior: number;
  priorStrength: number;
  minSamples: number;
  minConfidence: number;
  bands: ConfidenceBandThresholds;
}

interface IndexedProfile extends RuleCalibrationProfile {
  prior: number;
  strength: number;
  samples: number;
}

function resolveSettings(config: CalibrationConfig, issues: CalibrationIssue[]): Settings {
  const pick = <K extends keyof CalibrationConfig>(
    key: K,
    fallback: number,
    valid: (v: unknown) => boolean,
  ): number => {
    const value = config[key];
    if (value === undefined) return fallback;
    if (valid(value)) return value as number;
    issues.push({
      code: "INVALID_CONFIG",
      message: `${String(key)} is invalid (${JSON.stringify(value)}); using ${fallback}.`,
    });
    return fallback;
  };

  let bands = DEFAULT_BAND_THRESHOLDS;
  if (config.bandThresholds !== undefined) {
    if (validThresholds(config.bandThresholds)) bands = config.bandThresholds;
    else {
      issues.push({
        code: "INVALID_CONFIG",
        message: "bandThresholds must satisfy 0 <= medium < high <= 1; using defaults.",
      });
    }
  }
  return {
    defaultPrior: pick("defaultPrior", DEFAULT_PRIOR_CONFIDENCE, validProbability),
    priorStrength: pick("priorStrength", DEFAULT_PRIOR_STRENGTH, isPositive),
    minSamples: pick("minSamples", DEFAULT_MIN_SAMPLES, isNonNegativeInt),
    minConfidence: pick("minConfidence", 0, validProbability),
    bands,
  };
}

function indexProfiles(
  profiles: RuleCalibrationProfile[],
  settings: Settings,
  rulePackVersion: string | undefined,
  issues: CalibrationIssue[],
): Map<string, IndexedProfile> {
  const out = new Map<string, IndexedProfile>();
  const ordered = [...profiles].sort(
    (a, b) =>
      cmp(String(a?.ruleId), String(b?.ruleId)) ||
      sampleCount(b) - sampleCount(a) ||
      cmp(String(a?.rulePackVersion), String(b?.rulePackVersion)),
  );

  for (const profile of ordered) {
    const ruleId = typeof profile?.ruleId === "string" ? profile.ruleId.trim() : "";
    const prior = profile?.priorConfidence ?? settings.defaultPrior;
    const strength = profile?.priorStrength ?? settings.priorStrength;
    if (
      ruleId === "" ||
      !isNonNegativeInt(profile.truePositives) ||
      !isNonNegativeInt(profile.falsePositives) ||
      !validProbability(prior) ||
      !isPositive(strength)
    ) {
      issues.push({
        code: "INVALID_PROFILE",
        ruleId: ruleId || undefined,
        message: `Profile needs a ruleId, non-negative integer counts, a prior in [0, 1] and a positive strength; ignored.`,
      });
      continue;
    }
    if (rulePackVersion !== undefined && profile.rulePackVersion !== rulePackVersion) {
      issues.push({
        code: "STALE_PROFILE",
        ruleId,
        message: `Profile was recorded against rule pack ${JSON.stringify(profile.rulePackVersion ?? null)}, not ${JSON.stringify(rulePackVersion)}; ignored.`,
      });
      continue;
    }
    if (out.has(ruleId)) {
      issues.push({
        code: "DUPLICATE_PROFILE",
        ruleId,
        message: `More than one profile for this rule; keeping the one with the most samples.`,
      });
      continue;
    }
    out.set(ruleId, {
      ...profile,
      ruleId,
      prior,
      strength,
      samples: profile.truePositives + profile.falsePositives,
    });
  }
  return out;
}

function sampleCount(p: RuleCalibrationProfile): number {
  const n = (p?.truePositives ?? 0) + (p?.falsePositives ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function validThresholds(t: ConfidenceBandThresholds): boolean {
  return (
    !!t &&
    validProbability(t.high) &&
    validProbability(t.medium) &&
    t.medium < t.high
  );
}

function validProbability(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
}

function isPositive(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function isVerdict(v: unknown): v is OutcomeVerdict {
  return v === "true_positive" || v === "false_positive" || v === "ignored";
}

/** Clamped so 0 and 1 stay finite in log-odds space. */
function logit(p: number): number {
  const c = Math.min(0.999, Math.max(0.001, p));
  return Math.log(c / (1 - c));
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
