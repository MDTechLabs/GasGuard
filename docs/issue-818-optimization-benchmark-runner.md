# Soroban Optimization Benchmark Runner (#818)

## Problem
GasGuard already has a generic `BenchmarkRunner` in
`tests/benchmarks/benchmark-runner.ts` (scan time/accuracy over datasets) and
a `GasComparator` in `tests/benchmarks/gas-comparator.ts` (before/after gas
delta for a single fixture via `GasBenchmarkFixture`). Neither is wired to
run a full before/after **analysis pass** specifically for Soroban
optimization rules (e.g. `rules/stellar/optimization/loops/detect-inefficient-loop.ts`,
`rules/stellar/optimization/detect-inefficient-symbol-usage.ts`), so
developers can't get one command that proves an optimization suggestion
actually reduces estimated resource usage.

## Design
Add `SorobanOptimizationBenchmarkRunner` under a new
`packages/benchmark/soroban/` directory (sibling to `packages/gas-estimator/stellar/`),
reusing existing pieces rather than duplicating them:

- Takes a list of `GasBenchmarkFixture`-shaped entries (original/refactored
  Soroban source pairs), consistent with
  `tests/benchmarks/fixtures/storage-optimization.json`.
- For each fixture, runs the applicable rule(s) from `packages/rules/soroban/src/`
  and `packages/gas-estimator/stellar/fee-estimator.ts` against both
  `originalContract` and `refactoredContract` ("baseline" vs "optimized"
  analysis passes).
- Delegates the actual metric diffing to `GasComparator.benchmarkFixture`,
  producing one `GasBenchmarkReport` per fixture.
- Aggregates all reports into a `SorobanBenchmarkSummary` (pass/fail count,
  average `accuracy`, worst-case `deltaDifference`) for CI/report output.

## Acceptance Criteria
- [ ] Runner executes baseline analysis via existing Soroban rules/estimator
- [ ] Runner executes optimized analysis the same way
- [ ] Resource metrics compared using `GasComparator`-style output
- [ ] Aggregated benchmark results (`SorobanBenchmarkSummary`) generated
