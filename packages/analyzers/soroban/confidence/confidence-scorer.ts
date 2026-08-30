/**
 * Issue #789 — Soroban Optimization Confidence Scoring
 *
 * Assigns a 0–1 confidence score (and a human-readable level) to every
 * optimization recommendation. Confidence accounts for:
 *   - rule reliability (how proven / how often a rule yields correct findings),
 *   - code context (whether the surrounding code makes the optimization safe),
 *   - evidence strength (how strongly the trigger signals a real win).
 *
 * Scores are included in findings so downstream tooling (e.g. the auto-fix
 * framework, issue #790) can decide automatically which recommendations to
 * apply and which to present for manual review.
 */

/** Semantic confidence levels used across findings. */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

/** Factors that influence confidence. */
export interface ConfidenceFactors {
  /** 0–1 reliability of the rule itself (how often the rule fires correctly). */
  ruleReliability: number;
  /**
   * Code-context signal: whether the trigger site is "simple and safe to
   * change" (e.g. a single repeated call, no control-flow entanglement).
   */
  contextSafety: number;
  /** 0–1 evidence strength: how strongly the trigger indicates a real win. */
  evidenceStrength: number;
}

export interface ScoredFinding {
  /** Rule id that produced the finding. */
  ruleId: string;
  /** Raw recommendation text (unchanged). */
  recommendation: string;
  /** 0–1 confidence that the recommendation is safe and beneficial. */
  confidence: number;
  /** Categorical level derived from `confidence`. */
  level: ConfidenceLevel;
  /** Human-readable rationale describing how the score was derived. */
  rationale: string;
  /** Source line the finding refers to, if any. */
  line: number | null;
  /** Summary of the factor breakdown used in scoring. */
  factors: ConfidenceFactors;
}

const RULE_RELIABILITY_BY_ID: Record<string, number> = {
  'soroban-call-frequency': 0.8,
  'soroban-redundant-storage-read': 0.75,
  'soroban-unbounded-loop': 0.6,
  'soroban-unvalidated-contract-address': 0.7,
  'soroban-unsafe-call-target': 0.7,
  'soroban-interface-consistency': 0.65,
  'soroban-inefficient-interface-params': 0.6,
  'soroban-unused-state-variables': 0.9,
};

const DEFAULT_RULE_RELIABILITY = 0.55;

/**
 * Map a 0–1 score to a categorical level using fixed thresholds.
 */
export function levelFromScore(score: number): ConfidenceLevel {
  if (score >= 0.7) return 'high';
  if (score >= 0.4) return 'medium';
  return 'low';
}

/**
 * Normalize a raw factor into [0, 1]. Values above 1 are clamped to 1.
 */
function normalize(raw: number): number {
  return Math.max(0, Math.min(1, raw));
}

/**
 * Compute a composite confidence score from the individual factors.
 *
 * Uses a weighted product so that a very weak single factor drags the overall
 * confidence down (a recommendation is only as safe as its weakest evidence).
 */
export function computeConfidence(factors: ConfidenceFactors): number {
  const ruleReliability = normalize(factors.ruleReliability);
  const contextSafety = normalize(factors.contextSafety);
  const evidenceStrength = normalize(factors.evidenceStrength);

  // Weighted geometric mean; weights emphasize rule reliability.
  const weighted = Math.pow(ruleReliability, 0.5) *
    Math.pow(contextSafety, 0.3) *
    Math.pow(evidenceStrength, 0.2);

  return weighted;
}

/**
 * Build a default factor set from a rule id and optional context evidence.
 * Rule reliability comes from a curated table; context safety and evidence
 * strength can be overridden by callers.
 */
export function defaultFactors(
  ruleId: string,
  override: Partial<ConfidenceFactors> = {},
): ConfidenceFactors {
  return {
    ruleReliability: RULE_RELIABILITY_BY_ID[ruleId] ?? DEFAULT_RULE_RELIABILITY,
    contextSafety: 0.7,
    evidenceStrength: 0.7,
    ...override,
  };
}

/**
 * Score a single recommendation into a `ScoredFinding`.
 */
export function scoreFinding(
  ruleId: string,
  recommendation: string,
  factors: ConfidenceFactors,
  line: number | null = null,
): ScoredFinding {
  const confidence = computeConfidence(factors);
  const level = levelFromScore(confidence);
  const rationale = buildRationale(factors, ruleId);
  return { ruleId, recommendation, confidence, level, rationale, line, factors };
}

function buildRationale(factors: ConfidenceFactors, ruleId: string): string {
  const rel = normalize(factors.ruleReliability);
  const ctx = normalize(factors.contextSafety);
  const ev = normalize(factors.evidenceStrength);
  const parts: string[] = [];
  if (rel >= 0.7) parts.push(`rule '${ruleId}' is well-established`);
  else if (rel >= 0.4) parts.push(`rule '${ruleId}' is moderately reliable`);
  else parts.push(`rule '${ruleId}' has limited reliability`);
  if (ctx >= 0.7) parts.push('safe code context');
  else if (ctx >= 0.4) parts.push('moderate context safety');
  else parts.push('uncertain code context');
  if (ev >= 0.7) parts.push('strong evidence signal');
  else if (ev >= 0.4) parts.push('moderate evidence');
  else parts.push('weak evidence');
  return `Scored ${parts.join(', ')}.`;
}

/**
 * Batch-score a set of findings, attaching confidence metadata.
 */
export function scoreFindings(
  findings: Array<{
    ruleId: string;
    recommendation: string;
    line?: number | null;
    factors?: Partial<ConfidenceFactors>;
  }>,
): ScoredFinding[] {
  return findings.map((f) =>
    scoreFinding(f.ruleId, f.recommendation, defaultFactors(f.ruleId, f.factors), f.line ?? null),
  );
}