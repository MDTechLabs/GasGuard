# Implement Soroban State Mutation Analyzer

Closes #831

## Problem

`packages/rules/src/soroban/analyzer.rs` (`SorobanAnalyzer`) currently
checks struct/impl-level issues (unused state variables, inefficient field
types, unbounded loops) but has no notion of *how often* or *along which
paths* a contract mutates its own state. Frequent or redundant mutations
increase Soroban resource-fee consumption without being visible in the
existing checks. Issues #829/#830 need a shared mutation model to diff
against; this issue provides that foundation.

## Design

Add a new module tree `packages/rules/src/soroban/state/` (`mod.rs` plus
`mutation_analyzer.rs`), following the same layout as the existing
`packages/rules/src/soroban/memory/` module
(`mod.rs` re-exporting `InefficientBytesAllocationRule`).

`mutation_analyzer.rs` defines `StateMutationAnalyzer`, invoked from
`SorobanAnalyzer::analyze_implementation` in `analyzer.rs` alongside the
existing `analyze_function` calls. For each `SorobanFunction` it walks
`raw_definition` for `storage().*().set(...)` / `.update(...)` calls and
builds a `MutationPath { function: String, key: String, tier: StorageTier,
call_site_line: usize }` per occurrence, then groups paths by `(function,
key)` to compute a mutation count.

A companion `SorobanRule` impl, `StateMutationRule`, registered via
`SorobanRuleEngine::add_rule` in `rule_engine.rs`, reports:

- functions with more than N (configurable, default 3) mutations of the
  same key on one execution path -> "repeated update" violation
- the single most expensive mutation path per function (by tier: persistent
  > instance > temporary) surfaced as an informational `RuleViolation`

This `MutationPath` model is the shared input both issue #830 (storage
diffing) and issue #832 (redundant-write detection) build on.

## Acceptance Criteria

- [ ] `StateMutationAnalyzer` collects per-function, per-key mutation paths across all storage tiers
- [ ] Repeated updates to the same key on one path are counted and reported
- [ ] Most expensive mutation path per function is identified and surfaced
- [ ] `StateMutationRule` registered in `SorobanRuleEngine::with_default_rules`
- [ ] Tests added under `packages/rules/soroban/tests/` covering single, repeated, and multi-tier mutations
