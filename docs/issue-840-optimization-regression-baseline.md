# Issue #840: Soroban Optimization Regression Baseline

## Problem

GasGuard's Soroban rules (`packages/rules/soroban/src/`) and Rust engine
(`packages/rules/src/soroban/rule_engine.rs`) each produce point-in-time
results. Without a stored baseline, there is no stable reference to diff a
new analysis run against, so optimization regressions across commits or PRs
cannot be detected automatically.

## Design

Introduce `packages/rules/soroban/src/regression/baseline.ts` exporting a
`SorobanOptimizationBaseline` module with rule id
**`soroban-optimization-regression-baseline`**, following the `RULE_ID`
static-field convention used by `SorobanStorageRentCheckRule` in
`packages/rules/soroban/src/storage-rent-check.ts`.

Storage/versioning reuses the pattern already implemented by
`SorobanScanHistoryManager` (`src/history/scans/stellar/scan-history-manager.ts`)
and its `SorobanScanHistoryStorageConfig` type (`src/history/scans/stellar/types.ts`):
baselines are versioned JSON records under
`.gasguard/regression-baselines/<contract>/<version>.json`, keyed by contract
name + network passphrase, analogous to how `.gas-snapshot` at the repo root
already records per-function gas numbers (`GasBenchmarkSuite:test_gas_*`).

- **Input**: a `SorobanAnalysisResult` (from `src/diffing/stellar/types.ts`)
  plus a baseline label (git ref or semver).
- **Output**: a persisted `SorobanBaselineRecord` (metadata mirrors
  `SorobanScanMetadata`) and a `BaselineWriteResult { baselineId, version }`.
- **Comparison**: delegates diffing to the existing `SorobanResultDiffer`
  used by `SorobanScanHistoryManager`, rather than re-implementing diffing.

## Acceptance Criteria

- [ ] Baseline record schema defined (versioned, contract-scoped)
- [ ] Write path stores a new baseline version without overwriting prior ones
- [ ] Read path retrieves the latest or a specific version for comparison
- [ ] Comparison against a stored baseline returns a regression/no-regression verdict, consumed by #841 and #842
