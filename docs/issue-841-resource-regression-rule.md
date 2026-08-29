# Issue #841: Soroban Resource Regression Rule

## Problem

Contract changes can pass functional tests while still increasing CPU,
memory, or storage consumption. Today none of the Soroban rules in
`rules/stellar/optimization/` or `packages/rules/src/soroban/` (e.g.
`inefficient_loop.rs`, `inefficient_storage.rs`,
`memory/inefficient_bytes_allocation.rs`) compare against a prior run — each
only inspects the current source.

## Design

Add rule id **`soroban-resource-regression`** in
`packages/rules/soroban/src/regression/resource-regression.ts`, registered
the same way `SorobanRuleEngine::add_default_rules()`
(`packages/rules/src/soroban/rule_engine.rs`) registers rules such as
`InefficientBytesAllocationRule` — as a `SorobanRule` implementation with an
`id()` and severity via `ViolationSeverity`.

- **Inputs**: current `SorobanAnalysisResult` plus the baseline record from
  #840 (`SorobanOptimizationBaseline`), and resource estimates from
  `packages/gas-estimator/stellar/`.
- **Comparison logic**: reuses `GasImpactDiff` / `FunctionGasDiff`
  (already defined in `src/analysis/diff/code-diff-analyzer.ts`), which carry
  `oldGasEstimate`, `newGasEstimate`, `gasDifference`, and `percentChange` —
  this rule just needs to source real baseline data into those types and
  apply a threshold check.
- **Thresholds**: configurable per-metric (CPU/memory/storage) via
  `packages/config`, defaulting to a percent-change ceiling analogous to the
  `test_gas_coldWrite_withinCeiling` pattern seen in `.gas-snapshot`.
- **Output**: a `FunctionGasDiff[]` subset flagged `regressions`, surfaced as
  findings with rule id `soroban-resource-regression`.

## Acceptance Criteria

- [ ] Rule registered in the Soroban rule set alongside existing optimization rules
- [ ] Baseline comparison sourced from #840's stored baseline records
- [ ] CPU, memory, and storage thresholds independently configurable
- [ ] Regressions reported with per-function gas delta and percent change
