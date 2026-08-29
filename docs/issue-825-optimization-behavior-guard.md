# Soroban Optimization Behavior Guard

Closes #825

## Problem

GasGuard's autofix engine rewrites Soroban contract code to reduce resource
usage (e.g. rules under `rules/optimization/storage/` and
`rules/optimization/memory/`). A rewrite that lowers cost but changes
observable contract behavior — return values, emitted events, or storage
state — is unsafe to apply automatically, even if it compiles.

## Design

Introduce a behavior-comparison stage in the autofix validation pipeline:

- **Location**: `packages/autofix/validation/behavior/` (new package),
  consumed by the existing autofix orchestrator alongside the rule engine
  in `rules/optimization/`.
- **Baseline capture**: before applying a candidate fix, run the contract's
  existing Soroban test suite (via `packages/testing/soroban/`) against the
  unmodified source and snapshot: function return values, emitted events,
  and final ledger/storage entries per invocation.
- **Optimized capture**: apply the candidate patch in an isolated copy and
  re-run the same test invocations, capturing the same snapshot shape.
- **Diff**: structurally compare baseline vs. optimized snapshots. Any
  difference in return value, event payload/order, or storage key/value is
  classified as a **behavior divergence**.
- **Guard decision**: a fix with zero divergences is marked `safe`; any
  divergence marks it `rejected` and the autofix engine discards the patch
  and records the reason (see #826's audit trail).

## Acceptance Criteria

- [ ] `packages/autofix/validation/behavior/` module compares baseline and
      optimized execution results for a candidate fix.
- [ ] Divergences in return values, events, and storage state are detected.
- [ ] Optimizations with detected divergences are rejected before being
      surfaced to the user.
- [ ] Behavior comparison runs against the project's `packages/testing/soroban/`
      fixtures rather than requiring bespoke test authoring per rule.
