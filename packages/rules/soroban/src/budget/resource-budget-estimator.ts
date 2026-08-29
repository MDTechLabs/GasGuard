/**
 * Issue #781 — Soroban Resource Budget Estimator
 *
 * Aggregates static-analysis findings and produces a normalized estimate of
 * how much each detected pattern may affect Soroban's resource categories:
 *   • CPU instructions
 *   • Memory (bytes)
 *   • Ledger reads / writes
 *   • Transaction fees (relative)
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** A single analysis finding fed into the estimator. */
export interface AnalysisFinding {
  ruleId: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  /** Optional: how many times the pattern was detected (defaults to 1). */
  occurrences?: number;
}

/** Per-category resource cost estimate (0–100 relative scale). */
export interface ResourceCategoryEstimate {
  /** Soroban CPU instructions cost (relative, 0–100) */
  cpu: number;
  /** Memory / allocation cost (relative, 0–100) */
  memory: number;
  /** Ledger read/write operations cost (relative, 0–100) */
  ledger: number;
  /** Relative transaction fee impact (0–100) */
  fees: number;
}

/** Full budget report returned to callers. */
export interface ResourceBudgetReport {
  /** Total normalized impact score (sum of weighted category scores, 0–100) */
  totalImpact: number;
  /** Per-category breakdown */
  categories: ResourceCategoryEstimate;
  /** Human-readable summary */
  summary: string;
  /** Individual finding scores */
  findingScores: Array<{
    ruleId: string;
    impact: ResourceCategoryEstimate;
    note: string;
  }>;
}

// ── Cost table ────────────────────────────────────────────────────────────────

/**
 * Static cost weights per rule ID.
 * Each entry maps to a ResourceCategoryEstimate (0–100 scale per category).
 * Rules not listed get a default low-impact estimate.
 */
const RULE_COSTS: Record<string, ResourceCategoryEstimate> = {
  'soroban-unbounded-loop':           { cpu: 80, memory: 20, ledger: 10, fees: 50 },
  'soroban-inefficient-storage':      { cpu: 20, memory: 10, ledger: 80, fees: 60 },
  'soroban-unused-state-variables':   { cpu: 5,  memory: 5,  ledger: 30, fees: 20 },
  'soroban-redundant-clone':          { cpu: 30, memory: 60, ledger: 5,  fees: 20 },
  'soroban-redundant-event-emissions':{ cpu: 10, memory: 5,  ledger: 5,  fees: 40 },
  'soroban-authorization-cost':       { cpu: 40, memory: 10, ledger: 20, fees: 30 },
  'soroban-storage-rent':             { cpu: 5,  memory: 5,  ledger: 70, fees: 70 },
  'soroban-inefficient-bytes':        { cpu: 25, memory: 75, ledger: 5,  fees: 25 },
};

const DEFAULT_COST: ResourceCategoryEstimate = { cpu: 10, memory: 10, ledger: 10, fees: 10 };

/** Category weights used to compute the scalar `totalImpact`. */
const CATEGORY_WEIGHTS = { cpu: 0.35, memory: 0.15, ledger: 0.30, fees: 0.20 };

// ── Severity multipliers ──────────────────────────────────────────────────────

const SEVERITY_MULTIPLIER: Record<string, number> = {
  critical: 2.0,
  high:     1.5,
  medium:   1.0,
  low:      0.5,
  info:     0.2,
};

// ── Estimator ─────────────────────────────────────────────────────────────────

export class SorobanResourceBudgetEstimator {
  public static readonly RULE_ID = 'soroban-resource-budget';

  /**
   * Accepts a list of analysis findings (from any analyzer in the suite)
   * and returns a consolidated ResourceBudgetReport.
   */
  public estimate(findings: AnalysisFinding[]): ResourceBudgetReport {
    if (findings.length === 0) {
      return this.emptyReport();
    }

    const findingScores: ResourceBudgetReport['findingScores'] = [];
    const totals: ResourceCategoryEstimate = { cpu: 0, memory: 0, ledger: 0, fees: 0 };

    for (const finding of findings) {
      const base = RULE_COSTS[finding.ruleId] ?? DEFAULT_COST;
      const multiplier = (SEVERITY_MULTIPLIER[finding.severity] ?? 1.0) * (finding.occurrences ?? 1);

      const impact: ResourceCategoryEstimate = {
        cpu:    Math.min(100, base.cpu    * multiplier),
        memory: Math.min(100, base.memory * multiplier),
        ledger: Math.min(100, base.ledger * multiplier),
        fees:   Math.min(100, base.fees   * multiplier),
      };

      totals.cpu    += impact.cpu;
      totals.memory += impact.memory;
      totals.ledger += impact.ledger;
      totals.fees   += impact.fees;

      findingScores.push({
        ruleId: finding.ruleId,
        impact,
        note: this.noteForFinding(finding, impact),
      });
    }

    // Normalize totals to 0–100
    const count = findings.length;
    const categories: ResourceCategoryEstimate = {
      cpu:    Math.min(100, totals.cpu    / count),
      memory: Math.min(100, totals.memory / count),
      ledger: Math.min(100, totals.ledger / count),
      fees:   Math.min(100, totals.fees   / count),
    };

    const totalImpact = Math.min(
      100,
      categories.cpu    * CATEGORY_WEIGHTS.cpu +
      categories.memory * CATEGORY_WEIGHTS.memory +
      categories.ledger * CATEGORY_WEIGHTS.ledger +
      categories.fees   * CATEGORY_WEIGHTS.fees,
    );

    return {
      totalImpact: Math.round(totalImpact),
      categories: {
        cpu:    Math.round(categories.cpu),
        memory: Math.round(categories.memory),
        ledger: Math.round(categories.ledger),
        fees:   Math.round(categories.fees),
      },
      summary: this.buildSummary(totalImpact, categories, findings.length),
      findingScores,
    };
  }

  // ── private helpers ──────────────────────────────────────────────────────────

  private emptyReport(): ResourceBudgetReport {
    return {
      totalImpact: 0,
      categories: { cpu: 0, memory: 0, ledger: 0, fees: 0 },
      summary: 'No findings detected. Resource budget appears clean.',
      findingScores: [],
    };
  }

  private noteForFinding(finding: AnalysisFinding, impact: ResourceCategoryEstimate): string {
    const dominant = (Object.entries(impact) as Array<[keyof ResourceCategoryEstimate, number]>)
      .sort(([, a], [, b]) => b - a)[0];
    return `Primarily impacts ${dominant[0].toUpperCase()} (score: ${Math.round(dominant[1])})`;
  }

  private buildSummary(
    total: number,
    categories: ResourceCategoryEstimate,
    findingCount: number,
  ): string {
    const level = total >= 70 ? 'HIGH' : total >= 40 ? 'MODERATE' : 'LOW';
    const dominant = (Object.entries(categories) as Array<[string, number]>)
      .sort(([, a], [, b]) => b - a)[0];

    return (
      `Resource budget impact: ${level} (score ${Math.round(total)}/100) across ${findingCount} finding(s). ` +
      `Largest pressure on ${dominant[0].toUpperCase()} resources (score ${Math.round(dominant[1])}).`
    );
  }
}
