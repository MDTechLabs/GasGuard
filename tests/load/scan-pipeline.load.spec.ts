/**
 * Reliability load suite for the scan pipeline.
 *
 * Runs deterministic, virtual-time load against the real queue primitives
 * (dedup, quotas, leases, checkpoints, queue-age SLO). The simulator reports
 * broken invariants in `report.violations`; every scenario must finish with none.
 *
 * LOAD_SCALE=N (1-100) stretches each run N times longer.
 */

import { runSimulation, LoadReport } from "./scan-pipeline.simulator";
import {
  buildScenario,
  DEFAULT_SEED,
  NOISY_REPOSITORY,
  POISON_REPOSITORY,
  SCENARIO_NAMES,
  ScenarioName,
} from "./scenarios";
import { evaluateSlo, SLO_TARGETS } from "./slo";

const SCALE = Math.min(100, Math.max(1, Math.floor(Number(process.env.LOAD_SCALE ?? 1)) || 1));

jest.setTimeout(120_000);

const reports = new Map<ScenarioName, LoadReport>();
function run(name: ScenarioName, seed = DEFAULT_SEED): LoadReport {
  if (seed === DEFAULT_SEED && reports.has(name)) return reports.get(name) as LoadReport;
  const report = runSimulation(buildScenario(name, seed, SCALE));
  if (seed === DEFAULT_SEED) reports.set(name, report);
  return report;
}

describe("every scenario", () => {
  it.each(SCENARIO_NAMES)("%s: upholds all invariants and meets its SLO", (name) => {
    const report = run(name);
    expect(report.violations).toEqual([]);
    expect(report.uniqueScans).toBeGreaterThan(100);
    expect(report.completed + report.deadLettered).toBe(report.uniqueScans);
    expect(report.submitted).toBe(report.uniqueScans + report.deduplicated);
    expect(evaluateSlo(report, SLO_TARGETS[name]).failures).toEqual([]);
  });

  it.each(SCENARIO_NAMES)("%s: is deterministic for the same seed", (name) => {
    const again = runSimulation(buildScenario(name, DEFAULT_SEED, SCALE));
    expect(again).toEqual(run(name));
  });

  it("changes behaviour with a different seed", () => {
    const other = run("steady", DEFAULT_SEED + 1);
    expect(other.violations).toEqual([]);
    expect(other.wait).not.toEqual(run("steady").wait);
  });
});

describe("steady load", () => {
  it("completes everything without retries, faults or queue-age breaches", () => {
    const r = run("steady");
    expect(r.completed).toBe(r.uniqueScans);
    expect(r.deadLettered).toBe(0);
    expect(r.retries).toBe(0);
    expect(r.crashes + r.stalls + r.fencedOut + r.reaped).toBe(0);
    expect(r.replayedItems).toBe(0);
    expect(r.queueAge.breached).toBe(0);
    expect(r.workerUtilization).toBeGreaterThan(0.1);
    expect(r.workerUtilization).toBeLessThan(0.9);
    expect(r.throughputPerSec).toBeGreaterThan(0.5);
  });

  it("never exceeds the per-repository concurrency limit", () => {
    expect(run("steady").maxInFlightPerRepository).toBeLessThanOrEqual(2);
  });
});

describe("burst from one repository", () => {
  it("is held back by the window quota while other tenants stay responsive", () => {
    const r = run("burst");
    expect(r.quotaRejections.window).toBeGreaterThan(0);
    expect(r.perTenant[NOISY_REPOSITORY].completed).toBe(r.perTenant[NOISY_REPOSITORY].submitted);
    expect(r.maxQueueDepth).toBeGreaterThan(50);
    expect(r.quietWait.p95).toBeLessThanOrEqual(SLO_TARGETS.burst.maxQuietWaitP95Ms);
    // The burst tenant itself waits far longer than anyone else.
    expect(r.perTenant[NOISY_REPOSITORY].wait.p95).toBeGreaterThan(r.quietWait.p95);
  });
});

describe("noisy neighbor", () => {
  it("caps the noisy repository at its concurrency limit and protects quiet tenants", () => {
    const r = run("noisy-neighbor");
    expect(r.perTenant[NOISY_REPOSITORY].maxInFlight).toBeLessThanOrEqual(2);
    expect(r.quotaRejections.concurrency).toBeGreaterThan(0);
    expect(r.quietWait.p95).toBeLessThanOrEqual(SLO_TARGETS["noisy-neighbor"].maxQuietWaitP95Ms);
    expect(r.perTenant[NOISY_REPOSITORY].wait.p95).toBeGreaterThan(r.quietWait.p95 * 5);
    // Quiet tenants lose nothing.
    for (const [repo, t] of Object.entries(r.perTenant)) {
      if (repo !== NOISY_REPOSITORY) expect(t.completed + t.deadLettered).toBe(t.submitted);
    }
  });
});

describe("worker crashes and stalls", () => {
  it("reclaims abandoned scans, fences stale workers and resumes from checkpoints", () => {
    const r = run("worker-crash");
    expect(r.crashes).toBeGreaterThan(0);
    expect(r.stalls).toBeGreaterThan(0);
    // Every interrupted attempt is reclaimed exactly once...
    expect(r.reaped).toBe(r.crashes + r.stalls);
    // ...and every frozen worker that wakes up is refused by the lease manager.
    expect(r.fencedOut).toBe(r.stalls);
    // Checkpoint every 2 items: at most 2 items are redone per interruption.
    expect(r.replayedItems).toBeGreaterThan(0);
    expect(r.replayedItems).toBeLessThanOrEqual((r.crashes + r.stalls) * 2);
    expect(r.completed).toBeGreaterThan(r.uniqueScans * 0.95);
  });
});

describe("duplicate submission storm", () => {
  it("collapses re-sent revisions into a single scan each", () => {
    const r = run("duplicate-storm");
    expect(r.deduplicated).toBeGreaterThan(r.uniqueScans * 0.5);
    expect(r.submitted).toBe(r.uniqueScans + r.deduplicated);
    expect(r.completed).toBe(r.uniqueScans);
    expect(r.violations).toEqual([]); // includes "committed more than once"
  });
});

describe("retries and the dead-letter path", () => {
  it("dead-letters a poison repository after exhausting retries without blocking others", () => {
    const r = run("flaky-poison");
    const poison = r.perTenant[POISON_REPOSITORY];
    const poisonScans = poison.deadLettered + poison.completed;
    expect(poison.completed).toBe(0);
    expect(poison.deadLettered).toBeGreaterThan(20);
    expect(poisonScans).toBeGreaterThan(0);
    // 3 attempts per scan means 2 retries before giving up.
    expect(r.retries).toBeGreaterThanOrEqual(poison.deadLettered * 2);
    expect(r.completed).toBeGreaterThan(r.uniqueScans * 0.8);
    expect(r.quietWait.p95).toBeLessThanOrEqual(SLO_TARGETS["flaky-poison"].maxQuietWaitP95Ms);
  });
});

describe("chaos", () => {
  it.each([1, 2, 3, 4, 5])("holds every invariant with all faults combined (seed %i)", (seed) => {
    const r = runSimulation(buildScenario("chaos", seed, SCALE));
    expect(r.violations).toEqual([]);
    expect(r.completed + r.deadLettered).toBe(r.uniqueScans);
    expect(r.crashes + r.stalls + r.retries).toBeGreaterThan(0);
    expect(r.maxInFlightPerRepository).toBeLessThanOrEqual(2);
    expect(r.fencedOut).toBe(r.stalls);
  });
});

describe("SLO evaluation", () => {
  it("fails a degraded report and names what broke", () => {
    const healthy = run("steady");
    const degraded: LoadReport = {
      ...healthy,
      violations: ["t=1ms something broke"],
      completed: healthy.completed - 3,
      quietWait: { ...healthy.quietWait, p95: 999_999 },
      deadLettered: 1,
      queueAge: { ...healthy.queueAge, compliance: 0.5 },
    };
    const { passed, failures } = evaluateSlo(degraded, SLO_TARGETS.steady);
    expect(passed).toBe(false);
    expect(failures.join("\n")).toEqual(
      expect.stringContaining("invariant violated: t=1ms something broke"),
    );
    expect(failures.some((f) => f.includes("neither completed nor dead-lettered"))).toBe(true);
    expect(failures.some((f) => f.includes("wait p95"))).toBe(true);
    expect(failures.some((f) => f.includes("dead-letter ratio"))).toBe(true);
    expect(failures.some((f) => f.includes("queue-age compliance"))).toBe(true);
  });

  it("passes a healthy report", () => {
    expect(evaluateSlo(run("steady"), SLO_TARGETS.steady)).toEqual({ passed: true, failures: [] });
  });
});
