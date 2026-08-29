# Soroban Optimization Impact Calculator (#819)

## Problem
`GasComparator` (`tests/benchmarks/gas-comparator.ts`) already produces an
`actualDelta` and `estimatedDelta` for a single fixture, but this is a
benchmarking/testing utility, not a reusable calculator that rule
suggestions can call at analysis time to tell a developer "this optimization
saves ~X%". There's no shared, safe percentage-improvement calculation used
across `packages/rules/soroban/` and `packages/rules/src/optimization/`.

## Design
Add `SorobanOptimizationImpactCalculator` under
`packages/benchmark/soroban/impact/`, consumed by
`packages/analyzers/soroban/` rule output (e.g. the resource-limit warning
from #817 and existing `StorageRentWarning.estimatedRentSavings`):

- Input: a `ResourceMeasurement` pair per category, reusing the
  `GasExecutionTrace` shape (`gasUsed`, `resourceUnits`, `status`) from
  `tests/benchmarks/gas-comparator.ts` for "before" and "after".
- Categories: `cpu`, `memory`, `ledgerReads`, `ledgerWrites`, `txSize` — same
  dimensions as the #817 `ResourceLimitWarning.resource` union, so both
  features share one vocabulary.
- Calculation: `percentImprovement = (before - after) / before * 100`,
  guarding `before === 0` (returns `null` improvement rather than
  `Infinity`/`NaN`, matching how `estimatedDelta`/`actualDelta` already
  tolerate missing data in `GasBenchmarkReport`).
- Output: `ImpactResult { category, before, after, percentImprovement: number | null }[]`.
- Unavailable measurements (e.g. estimator returned no trace, `status ===
  'error'`) are represented as `percentImprovement: null` with a `reason`
  string, never thrown.

## Acceptance Criteria
- [ ] Calculator computes before/after usage per category
- [ ] Percentage improvement computed with divide-by-zero guarded
- [ ] Supports `cpu`/`memory`/`ledgerReads`/`ledgerWrites`/`txSize` categories
- [ ] Missing/error measurements return `null` improvement, not a throw
