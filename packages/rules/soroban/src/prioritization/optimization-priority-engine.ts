/**
 * Issue #782 — Soroban Optimization Priority Engine
 *
 * Ranks analysis findings by expected optimization impact so developers
 * can fix the most impactful issues first.
 *
 * Score formula (configurable weights):
 *   score = (severity * w_sev) + (resourceImpact * w_res) + (complexityInverse * w_cmp)
 *
 * `complexityInverse` rewards easy wins: low complexity → high score contribution.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/** How difficult the fix is estimated to be. */
export type FixComplexity = 'trivial' | 'simple' | 'moderate' | 'complex';

/** A finding fed into the priority engine. */
export interface PrioritizableFinding {
  id: string;
  ruleId: string;
  severity: FindingSeverity;
  /** Relative resource impact (0–100); can come from the ResourceBudgetEstimator. */
  resourceImpact: number;
  /** Estimated fix complexity (defaults to 'moderate' if omitted). */
  fixComplexity?: FixComplexity;
  /** Optional human-readable description carried through to the output. */
  description?: string;
}

/** A finding with its computed priority score and rank. */
export interface PrioritizedFinding extends PrioritizableFinding {
  /** Computed priority score (0–100). */
  priorityScore: number;
  /** 1-based rank (1 = highest priority). */
  rank: number;
  /** Short rationale for the assigned score. */
  rationale: string;
}

/** Configurable scoring weights (must sum to 1.0). */
export interface ScoringWeights {
  /** Weight applied to severity score (0–1). */
  severity: number;
  /** Weight applied to resource impact (0–1). */
  resourceImpact: number;
  /** Weight applied to fix complexity inverse (0–1). */
  fixComplexity: number;
}

// ── Default configuration ────────────────────────────────────────────────────

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  severity:       0.45,
  resourceImpact: 0.35,
  fixComplexity:  0.20,
};

const SEVERITY_SCORE: Record<FindingSeverity, number> = {
  critical: 100,
  high:      80,
  medium:    55,
  low:       30,
  info:      10,
};

/** Lower complexity → higher inverse score (easy wins surface first). */
const COMPLEXITY_INVERSE_SCORE: Record<FixComplexity, number> = {
  trivial:  100,
  simple:    75,
  moderate:  50,
  complex:   20,
};

// ── Engine ───────────────────────────────────────────────────────────────────

export class SorobanOptimizationPriorityEngine {
  public static readonly RULE_ID = 'soroban-optimization-priority';

  private readonly weights: ScoringWeights;

  constructor(weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS) {
    this.validateWeights(weights);
    this.weights = weights;
  }

  /**
   * Ranks findings by priority score (descending).
   * Returns the same list with `priorityScore` and `rank` populated.
   */
  public rank(findings: PrioritizableFinding[]): PrioritizedFinding[] {
    if (findings.length === 0) return [];

    const scored = findings.map((f) => this.score(f));
    scored.sort((a, b) => b.priorityScore - a.priorityScore);

    return scored.map((f, index) => ({ ...f, rank: index + 1 }));
  }

  /**
   * Convenience: rank and return only the top N findings.
   */
  public topN(findings: PrioritizableFinding[], n: number): PrioritizedFinding[] {
    return this.rank(findings).slice(0, n);
  }

  // ── private helpers ──────────────────────────────────────────────────────────

  private score(finding: PrioritizableFinding): PrioritizedFinding {
    const sevScore = SEVERITY_SCORE[finding.severity] ?? 0;
    const resScore = Math.min(100, Math.max(0, finding.resourceImpact));
    const cmpScore = COMPLEXITY_INVERSE_SCORE[finding.fixComplexity ?? 'moderate'];

    const raw =
      sevScore * this.weights.severity +
      resScore * this.weights.resourceImpact +
      cmpScore * this.weights.fixComplexity;

    const priorityScore = Math.round(Math.min(100, raw));

    return {
      ...finding,
      priorityScore,
      rank: 0, // filled after sort
      rationale: this.buildRationale(sevScore, resScore, cmpScore, priorityScore),
    };
  }

  private buildRationale(
    sevScore: number,
    resScore: number,
    cmpScore: number,
    total: number,
  ): string {
    const parts: string[] = [];
    if (sevScore >= 80)  parts.push('high severity');
    if (resScore >= 60)  parts.push('significant resource impact');
    if (cmpScore >= 75)  parts.push('easy to fix');
    if (parts.length === 0) parts.push('moderate overall impact');
    return `Score ${total}/100 — ${parts.join(', ')}.`;
  }

  private validateWeights(w: ScoringWeights): void {
    const sum = w.severity + w.resourceImpact + w.fixComplexity;
    if (Math.abs(sum - 1.0) > 0.01) {
      throw new Error(
        `ScoringWeights must sum to 1.0 (got ${sum.toFixed(3)}). ` +
        `Adjust severity, resourceImpact, and fixComplexity accordingly.`,
      );
    }
  }
}
