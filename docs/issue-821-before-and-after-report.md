# Soroban Before-and-After Report (#821)

## Problem
After an optimization pass runs against a Soroban contract, developers have no
consolidated view of what actually changed. They must manually diff findings
and resource metrics between the original and optimized source, which is slow
and error-prone.

## Design
Add a comparison reporter that consumes two analysis runs (pre- and
post-optimization) produced by `packages/rules/soroban` (see
`packages/rules/soroban/src/analyzer/wasm-inspector.ts` for the existing
finding shape) and the resource metrics already emitted by
`packages/benchmark`.

Proposed layout:
- `packages/reporting/soroban/comparison/` — report builder and formatters
  (JSON + Markdown output, mirroring the style of `docs/RULE_TESTING_FRAMEWORK.md`).
- `packages/benchmark/soroban/` — resource snapshot capture used as report
  input (CPU instructions, storage read/write bytes).

The builder diffs two `Finding[]` arrays keyed by rule id + location to
classify each as resolved, new, or unchanged, and diffs the resource
snapshots numerically (absolute + percentage change).

## Report Sections
1. Changed findings (resolved / newly introduced)
2. Resource differences (instructions, storage I/O, before vs. after)
3. Applied optimizations (rule id, description, location)
4. Remaining issues (findings still present after optimization)

## Acceptance Criteria
- [ ] Comparison report implemented in `packages/reporting/soroban/comparison/`
- [ ] Resource changes displayed with before/after/delta values
- [ ] Applied optimizations listed with rule id and source location
- [ ] Remaining findings included, grouped by severity
