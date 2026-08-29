# Detect Redundant Soroban State Mutations

Closes #832

## Problem

Writing a storage value that is identical to its current value still incurs
a full `SSTORE`-equivalent Soroban resource-fee charge, with no state benefit.
`packages/rules/src/soroban/redundant_clone.rs` already detects a related but
distinct pattern (unnecessary `.clone()` calls); no equivalent rule exists
for redundant storage writes, and conditional mutations (writes inside an
`if`/`match` arm) are not handled by any existing rule.

## Design

Add `packages/rules/src/soroban/state/redundant_mutation.rs` alongside
`mutation_analyzer.rs` from #831, reusing its `MutationPath` output rather
than re-parsing the contract. `RedundantMutationRule` (another `SorobanRule`,
registered next to `StateMutationRule` in `rule_engine.rs`) inspects each
`MutationPath` and:

- compares the value expression being written against the last known read or
  write of the same key on the same path (literal/identifier comparison,
  same "analyzable vs. not" fallback used in issue #830's `storage_diff.rs`)
  and flags an exact match as a redundant write
- for conditional mutations (call site inside an `if`/`else`/`match` arm,
  detected from indentation/brace depth relative to the arm in
  `raw_definition`), flags the write only when *every* branch writes the
  same value, since a value-changing branch makes the write non-redundant
- for confirmed redundant writes, generates an optimization suggestion
  string (e.g. "skip write: value unchanged from prior write at line N"),
  attached to the `RuleViolation.suggestion` field used elsewhere in
  `packages/rules/src/optimization/`

Violations use `ViolationSeverity::Info` (optimization, not correctness) so
they surface as suggestions rather than blocking autofix, consistent with
how `packages/rules/src/optimization/storage/multiple_storage_reads.rs`
reports its findings.

## Acceptance Criteria

- [ ] Redundant writes (same key, same value as prior write/read) detected via `MutationPath` from #831
- [ ] Conditional/branch-guarded writes analyzed per-branch, not flagged unless all branches redundant
- [ ] Optimization suggestion string generated and attached per violation
- [ ] `RedundantMutationRule` registered in `SorobanRuleEngine::with_default_rules`
- [ ] Tests added under `packages/rules/soroban/tests/` covering unconditional and conditional redundant writes
