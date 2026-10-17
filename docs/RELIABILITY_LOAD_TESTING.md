# Reliability Load Testing

A deterministic load suite for the scan pipeline. It drives the production queue primitives under
heavy, bursty and faulty load and fails when a reliability invariant breaks or an SLO target is missed.

| Piece | Location |
| --- | --- |
| Simulator (wires the real components) | `tests/load/scan-pipeline.simulator.ts` |
| Scenarios | `tests/load/scenarios.ts` |
| SLO targets and evaluation | `tests/load/slo.ts` |
| Seeded RNG, event scheduler, percentile stats | `tests/load/harness/` |
| Unit tests (harness, config validation) | `tests/load/harness/harness.spec.ts` |
| Scenario tests | `tests/load/scan-pipeline.load.spec.ts` |
| Integration test (real job handler) | `tests/load/scan-handler.load.spec.ts` |
| CLI report | `scripts/run-load-test.ts` |

## How it works

The simulator runs a pool of workers in **virtual time**: nothing sleeps, so ten simulated minutes
run in well under a second and give identical results on every machine. Only the clock, the scan
bodies and the faults are simulated. Every admission, lease and checkpoint decision is made by the
real code in `apps/api/src/queue/`:

| Concern | Component |
| --- | --- |
| Duplicate submissions | `ScanDeduplicator` |
| Per-repository concurrency and rate | `RepositoryScanQuota` |
| Exclusive ownership, fencing tokens | `ScanLeaseManager` |
| Resuming interrupted scans | `ScanCheckpointStore` |
| Queue-age health | `QueueAgeSlo` |

Dependencies: the queue modules above (read-only, nothing is modified) and, for the integration
test, `CommandInjectionScanJobHandler` and `FindingsService`. No Redis, BullMQ, network or database
is used.

## Running

```bash
npm run test:load                                   # all load specs
LOAD_SCALE=20 npm run test:load                     # 20x longer runs (1-100)
npm run load:report                                 # every scenario
npm run load:report -- --scenario worker-crash --seed 7 --scale 5
```

`load:report` exits 1 on any invariant violation or missed SLO, so it can gate CI. A failing run is
reproducible from its scenario, seed and scale alone.

## Scenarios

| Scenario | What it stresses |
| --- | --- |
| `steady` | 12 tenants at a comfortable load: baseline latency, no faults. |
| `burst` | 150 scans from one repository in 2 s against a tight window quota. |
| `noisy-neighbor` | One repository submits about 15x the others. Others must stay responsive. |
| `worker-crash` | Workers die mid-scan, or freeze past their lease and wake up as zombies. |
| `duplicate-storm` | Clients re-send the same revision up to 4 times. |
| `flaky-poison` | Random failures with backoff, plus a repository whose scans always fail. |
| `chaos` | All of the above together; the tests run it over five seeds. |

## Invariants

These are checked continuously and reported in `LoadReport.violations`. Any entry fails the run.

- A scan commits at most once, and every unique scan ends completed or dead-lettered (none lost).
- A stale fencing token can never renew a lease, and a frozen worker that wakes up is refused.
- A worker never loses a lease it is actively renewing.
- The quota's in-flight count always matches the scans actually running, and never exceeds the
  per-repository limit. No window ever admits more than its allowance.
- Checkpoints never move backwards, and an interruption replays at most `checkpointEvery` items per
  crash, stall or failure.
- Duplicate revisions never produce a second scan.
- After draining there are no live leases, no leaked quota slots and no queued work.

## SLO targets

`tests/load/slo.ts` sets, per scenario, a ceiling for the p95 wait of non-noisy tenants, a ceiling
for the dead-letter ratio, and (for `steady`) a minimum queue-age compliance. Targets are generous
on purpose so they catch real regressions, such as a quota change that starves quiet tenants.
Tighten them as the system improves.

## Failure semantics and secure defaults

- **Invalid configuration** (`workers < 1`, lease TTL shorter than two item durations, fault rates
  above 1, duplicate tenants, and so on) throws a `RangeError` before any work runs.
- **Broken invariants never throw.** The run continues and lists every violation (capped at 50) so
  one run shows everything wrong.
- **Bounded by design:** `LOAD_SCALE` and `--scale` are limited to 100, and a run stops with a
  violation after 5,000,000 events instead of hanging.
- **Safe to run anywhere:** no network, no filesystem writes, no wall-clock timers, and
  `Math.random` is never used. The integration test uses only tenant IDs it generates.

## Adding a scenario

1. Add a name to `SCENARIO_NAMES` and a `case` in `buildScenario` (`scenarios.ts`).
2. Add its targets to `SLO_TARGETS` (`slo.ts`). The compiler will complain if you forget.
3. Add a `describe` block to `scan-pipeline.load.spec.ts` asserting what makes the scenario
   distinctive. The generic invariant and determinism tests pick it up automatically.

## Limits

The suite exercises the logic of the queue primitives, not the throughput of Redis or BullMQ. It
runs in one process on one logical clock, so it cannot show network partitions between workers and
a shared store or real-clock behaviour. Pair it with an environment-level soak test for those.
