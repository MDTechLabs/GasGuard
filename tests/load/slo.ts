/**
 * Reliability targets per scenario.
 *
 * Invariant violations are never tolerated. The latency and dead-letter targets
 * are deliberately generous (several times what the scenarios typically
 * produce) so they flag real regressions, such as a quota change that starves
 * quiet tenants, rather than noise. Tighten them as the system improves.
 */

import { LoadReport } from "./scan-pipeline.simulator";
import { ScenarioName } from "./scenarios";

export interface SloTargets {
  /** p95 of submission-to-start for tenants that are not noisy. */
  maxQuietWaitP95Ms: number;
  /** Fraction of unique scans allowed to end in the dead-letter queue. */
  maxDeadLetterRatio: number;
  /** Fraction of queue-age samples that must be healthy. Omit to skip. */
  minQueueAgeCompliance?: number;
}

export const SLO_TARGETS: Record<ScenarioName, SloTargets> = {
  steady: { maxQuietWaitP95Ms: 15_000, maxDeadLetterRatio: 0, minQueueAgeCompliance: 0.95 },
  burst: { maxQuietWaitP95Ms: 20_000, maxDeadLetterRatio: 0 },
  "noisy-neighbor": { maxQuietWaitP95Ms: 15_000, maxDeadLetterRatio: 0 },
  "worker-crash": { maxQuietWaitP95Ms: 30_000, maxDeadLetterRatio: 0.02 },
  "duplicate-storm": { maxQuietWaitP95Ms: 15_000, maxDeadLetterRatio: 0 },
  "flaky-poison": { maxQuietWaitP95Ms: 15_000, maxDeadLetterRatio: 0.15 },
  chaos: { maxQuietWaitP95Ms: 60_000, maxDeadLetterRatio: 0.15 },
};

export interface SloEvaluation {
  passed: boolean;
  failures: string[];
}

export function evaluateSlo(report: LoadReport, targets: SloTargets): SloEvaluation {
  const failures: string[] = [];

  for (const violation of report.violations) {
    failures.push(`invariant violated: ${violation}`);
  }
  if (report.completed + report.deadLettered !== report.uniqueScans) {
    failures.push(
      `${report.uniqueScans - report.completed - report.deadLettered} scans neither completed nor dead-lettered`,
    );
  }
  if (report.quietWait.p95 > targets.maxQuietWaitP95Ms) {
    failures.push(`quiet-tenant wait p95 ${report.quietWait.p95}ms exceeds ${targets.maxQuietWaitP95Ms}ms`);
  }
  const dlqRatio = report.uniqueScans === 0 ? 0 : report.deadLettered / report.uniqueScans;
  if (dlqRatio > targets.maxDeadLetterRatio) {
    failures.push(`dead-letter ratio ${dlqRatio.toFixed(3)} exceeds ${targets.maxDeadLetterRatio}`);
  }
  if (
    targets.minQueueAgeCompliance !== undefined &&
    report.queueAge.compliance < targets.minQueueAgeCompliance
  ) {
    failures.push(`queue-age compliance ${report.queueAge.compliance} is below ${targets.minQueueAgeCompliance}`);
  }
  return { passed: failures.length === 0, failures };
}
