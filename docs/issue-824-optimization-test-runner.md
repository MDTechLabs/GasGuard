# Soroban Optimization Test Runner (#824)

## Problem
Passing compilation (#823) does not guarantee an optimized contract still
behaves correctly. Existing contract tests need to run against the
transformed source to catch behavioral regressions before a fix is accepted.

## Design
Add a test runner invoked by `packages/autofix` after the compilation
validator succeeds, using the same Rust integration point described in
`docs/issue-823-optimization-compilation-validator.md`.

Proposed layout:
- `packages/autofix/validation/tests/` — test runner entry point.
- `packages/testing/soroban/` — baseline test result capture and
  comparison logic, reusable outside the autofix flow (e.g. manual CLI
  runs against `packages/cli`).

## Flow
1. Detect available tests for the contract crate (`cargo test` targets
   declared in the crate's `Cargo.toml`, mirroring how
   `packages/integrations/rust` locates the crate for #823).
2. Record a baseline result by running the same tests against the
   pre-optimization source first.
3. Execute the same test set against the optimized source via
   `packages/integrations/rust`.
4. Capture per-test pass/fail/error and duration; diff against baseline by
   test name.
5. Any test that passed in baseline and fails post-optimization is
   reported as a regression and fails the run, feeding into the quality
   gate (#822).

## Acceptance Criteria
- [ ] Optimization test runner implemented in `packages/autofix/validation/tests/`
- [ ] Contract tests executed against the optimized source
- [ ] Test failures detected and reported per test
- [ ] Baseline (pre-optimization) comparison supported via `packages/testing/soroban/`
