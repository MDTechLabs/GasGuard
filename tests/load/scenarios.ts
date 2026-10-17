/**
 * Named load scenarios for the scan pipeline.
 *
 * Each scenario is a plain SimulationConfig, so it can be tweaked, run from the
 * CLI (`npm run load:report`) or imported by tests. `scale` stretches the
 * arrival window (not the arrival rate), so utilisation stays comparable while
 * the number of scans grows. At scale 1 each scenario submits roughly 700 to
 * 1,500 scans and runs in well under a second.
 */

import { SimulationConfig, TenantProfile } from "./scan-pipeline.simulator";

export const SCENARIO_NAMES = [
  "steady",
  "burst",
  "noisy-neighbor",
  "worker-crash",
  "duplicate-storm",
  "flaky-poison",
  "chaos",
] as const;

export type ScenarioName = (typeof SCENARIO_NAMES)[number];

export const DEFAULT_SEED = 20240611;
export const MAX_SCALE = 100;

const TENANT_COUNT = 12;
const BASE_RATE_PER_SEC = 0.1;

/** repo-00 is the tenant scenarios turn into the noisy or bursting one. */
export const NOISY_REPOSITORY = "repo-00";
export const POISON_REPOSITORY = "repo-11";

function tenants(overrides: Record<string, Partial<TenantProfile>> = {}): TenantProfile[] {
  return Array.from({ length: TENANT_COUNT }, (_, i) => {
    const repositoryId = `repo-${String(i).padStart(2, "0")}`;
    return { repositoryId, ratePerSec: BASE_RATE_PER_SEC, role: "normal", ...overrides[repositoryId] };
  });
}

function base(name: string, seed: number, scale: number): SimulationConfig {
  return {
    name,
    seed,
    workers: 8,
    arrivalWindowMs: 600_000 * scale,
    tenants: tenants(),
    // 5 items per scan, checkpoint every 2: an interruption replays at most 2.
    service: { minMs: 1_500, maxMs: 3_500, items: 5, checkpointEvery: 2 },
    leaseTtlMs: 15_000,
    reaperIntervalMs: 5_000,
    sampleIntervalMs: 5_000,
    quota: { maxConcurrentPerRepository: 2, maxScansPerWindow: 60, windowMs: 60_000 },
    queueAge: { warningMs: 10_000, breachMs: 30_000 },
    retry: { maxAttempts: 3, backoffMs: 1_000, multiplier: 2 },
    faults: {
      crashRate: 0,
      stallRate: 0,
      failRate: 0,
      duplicateRate: 0,
      maxDuplicates: 0,
      workerRestartMs: 5_000,
      stallMs: 30_000,
    },
  };
}

export function buildScenario(name: ScenarioName, seed = DEFAULT_SEED, scale = 1): SimulationConfig {
  if (!Number.isInteger(scale) || scale < 1 || scale > MAX_SCALE) {
    throw new RangeError(`scale must be an integer between 1 and ${MAX_SCALE}`);
  }
  const cfg = base(name, seed, scale);

  switch (name) {
    case "steady":
      return cfg;

    case "burst":
      // 150 scans from one repository in two seconds, against a tight window quota.
      cfg.quota = { maxConcurrentPerRepository: 2, maxScansPerWindow: 10, windowMs: 30_000 };
      cfg.tenants = tenants({
        [NOISY_REPOSITORY]: { role: "noisy", burst: { atMs: 60_000, count: 150, spreadMs: 2_000 } },
      });
      return cfg;

    case "noisy-neighbor":
      // One repository submits ~15x the others and exceeds what its quota allows.
      cfg.tenants = tenants({ [NOISY_REPOSITORY]: { role: "noisy", ratePerSec: 1.5 } });
      return cfg;

    case "worker-crash":
      cfg.faults = { ...cfg.faults, crashRate: 0.06, stallRate: 0.04 };
      return cfg;

    case "duplicate-storm":
      cfg.faults = { ...cfg.faults, duplicateRate: 0.6, maxDuplicates: 4 };
      return cfg;

    case "flaky-poison":
      // The poison repository fails on its first item every attempt (checkpoints
      // are every 2 items, so it never gets far enough to save one).
      cfg.faults = { ...cfg.faults, failRate: 0.1 };
      cfg.tenants = tenants({ [POISON_REPOSITORY]: { poison: true } });
      return cfg;

    case "chaos":
      cfg.faults = {
        ...cfg.faults,
        crashRate: 0.04,
        stallRate: 0.03,
        failRate: 0.05,
        duplicateRate: 0.3,
        maxDuplicates: 3,
      };
      cfg.tenants = tenants({
        [NOISY_REPOSITORY]: { role: "noisy", ratePerSec: 0.6, burst: { atMs: 120_000, count: 60, spreadMs: 3_000 } },
        [POISON_REPOSITORY]: { poison: true },
      });
      return cfg;

    default:
      throw new RangeError(`unknown scenario: ${String(name)}`);
  }
}
