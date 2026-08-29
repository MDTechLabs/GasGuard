# Soroban Optimization Benchmark Fixtures (#820)

## Problem
The only existing benchmark fixture is
`tests/benchmarks/fixtures/storage-optimization.json`, a single
storage-focused example. The #818 benchmark runner and #819 impact
calculator need a consistent, multi-category set of Soroban fixtures to
exercise — covering the optimization categories GasGuard already detects in
`rules/stellar/optimization/` (symbol usage, loops) and
`packages/rules/soroban/src/` (storage rent).

## Design
Add fixtures under `packages/benchmark/fixtures/soroban/`, reusing the exact
JSON shape already defined by `GasBenchmarkFixture` in
`tests/benchmarks/gas-comparator.ts` (`name`, `description`,
`originalContract`, `refactoredContract`, `method`, `estimatedGasDelta`):

- `storage-fixture.json` — persistent-vs-temporary storage key, mirrors
  `SorobanStorageRentCheckRule`'s ephemeral-keyword detection.
- `loop-fixture.json` — unbounded vs. bounded/early-exit loop, matching
  `rules/stellar/optimization/loops/detect-inefficient-loop.ts`.
- `call-chain-fixture.json` — reduced cross-contract call depth, aligned
  with `rules/stellar/cross-contract/`.
- `serialization-fixture.json` — reduced payload/field count on a Soroban
  `Symbol`/struct write, matching
  `rules/stellar/optimization/detect-inefficient-symbol-usage.ts`.

Each fixture file documents its expected optimization outcome directly in
`description` plus a `expectedImprovement` field (approximate % from #819's
calculator, e.g. `"expectedImprovement": 15`), and is registered in
`tests/benchmarks/stellar-rules/index.ts` so `benchmark-runner.spec.ts` and
`gas-comparator.spec.ts` can load the full set by directory scan instead of
one hardcoded file.

## Acceptance Criteria
- [ ] Storage, loop, call-chain, and serialization fixtures added
- [ ] All four major optimization categories represented
- [ ] Each fixture documents its expected result (`expectedImprovement`)
- [ ] Fixtures registered/loadable from existing `tests/benchmarks` suite
