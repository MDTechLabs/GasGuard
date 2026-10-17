/**
 * Rule execution isolation boundaries (#1157).
 *
 * Each rule runs inside a boundary that caps its blast radius: a rule that
 * throws, or that overruns its wall-clock budget, is reported as an isolated
 * failure and the remaining rules still run. Findings from a rule that
 * overran are discarded rather than published, so a stuck rule cannot emit a
 * partial result set.
 *
 * The isolator owns no timers and no I/O; the clock is injected so behaviour is
 * deterministic in tests.
 */

export interface RuleIsolationLimits {
  /** Maximum findings a single rule may contribute. */
  maxFindings: number;
  /** Wall-clock budget for one rule, in milliseconds. */
  budgetMs: number;
}

export type RuleIsolationReason = "error" | "budget_exceeded";

export type RuleOutcome<T> =
  | { ruleId: string; status: "ok"; findings: T[]; durationMs: number }
  | {
      ruleId: string;
      status: "failed";
      reason: RuleIsolationReason;
      message: string;
      durationMs: number;
    };

export const DEFAULT_RULE_ISOLATION_LIMITS: RuleIsolationLimits = {
  maxFindings: 5_000,
  budgetMs: 30_000,
};

export class RuleExecutionIsolator {
  private readonly limits: RuleIsolationLimits;
  private readonly clock: () => number;

  constructor(limits: Partial<RuleIsolationLimits> = {}, clock: () => number = Date.now) {
    this.limits = { ...DEFAULT_RULE_ISOLATION_LIMITS, ...limits };
    validateLimits(this.limits);
    this.clock = clock;
  }

  /**
   * Run one rule inside its isolation boundary.
   *
   * `execute` must be synchronous and side-effect free; anything it throws is
   * caught and converted into a failed outcome for that rule only.
   */
  run<T>(ruleId: string, execute: () => readonly T[]): RuleOutcome<T> {
    requireNonEmpty(ruleId, "ruleId");
    const startedAt = this.clock();

    try {
      const findings = [...execute()].slice(0, this.limits.maxFindings);
      const durationMs = this.clock() - startedAt;

      if (durationMs > this.limits.budgetMs) {
        return {
          ruleId,
          status: "failed",
          reason: "budget_exceeded",
          message: `rule ${ruleId} exceeded its ${this.limits.budgetMs}ms budget`,
          durationMs,
        };
      }

      return { ruleId, status: "ok", findings, durationMs };
    } catch (error) {
      return {
        ruleId,
        status: "failed",
        reason: "error",
        message: error instanceof Error ? error.message : "rule failed",
        durationMs: this.clock() - startedAt,
      };
    }
  }

  /** Run every rule, preserving the supplied order. */
  runAll<T>(
    rules: ReadonlyArray<{ ruleId: string; execute: () => readonly T[] }>,
  ): Array<RuleOutcome<T>> {
    return rules.map((rule) => this.run(rule.ruleId, rule.execute));
  }
}

function validateLimits(limits: RuleIsolationLimits): void {
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new RangeError(`rule isolation ${key} must be a positive integer`);
    }
  }
}

function requireNonEmpty(value: unknown, field: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}
