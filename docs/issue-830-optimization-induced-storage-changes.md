# Detect Optimization-Induced Storage Changes

Closes #830

## Problem

Storage-focused optimizations (batching writes, hoisting reads out of loops,
collapsing redundant `get`/`set` pairs — see
`packages/rules/src/optimization/storage/multiple_storage_reads.rs`) can
accidentally drop a required `env.storage().persistent().set(...)` call, or
introduce a new write that was never in the original contract. Neither case
is currently caught before a fix is applied to Soroban contracts, unlike the
existing rent-cost check in `packages/rules/soroban/src/storage-rent-check.ts`,
which only looks at TTL/rent, not write-set equivalence.

## Design

Add `packages/rules/src/soroban/storage_diff.rs`, registered in
`packages/rules/src/soroban/mod.rs` next to `inefficient_storage.rs`. It
walks each `SorobanFunction.raw_definition` (available on the AST types in
`packages/rules/src/soroban/mod.rs`) for calls into
`storage().persistent()`, `storage().temporary()`, and `storage().instance()`
`set`/`remove`/`extend_ttl` invocations, recording, per function: the storage
tier, the operation kind, and the key expression where it is a literal or a
simple identifier (falling back to "unanalyzable" otherwise, consistent with
requirement "track affected keys where analyzable").

The pre-fix and post-fix operation lists are diffed the same way as the
autofix validation flow used for `packages/autofix/validation/storage/`:

- key present pre-fix, absent post-fix -> removed write (flagged)
- key absent pre-fix, present post-fix -> new/unexpected write (flagged)
- key present in both, tier or op kind changed -> persistence-behavior change

Findings surface as `RuleViolation`s (`crate::RuleViolation`) with severity
`Warning` for unanalyzable keys and `Error` for confirmed removed/added
writes, consumed by `packages/autofix/validation/storage/`.

## Acceptance Criteria

- [ ] Storage operation lists extracted per function for persistent/temporary/instance tiers
- [ ] Removed writes flagged as `ViolationSeverity::Error`
- [ ] Newly introduced writes flagged as `ViolationSeverity::Error`
- [ ] Non-literal/unanalyzable keys reported at `Warning` rather than silently skipped
- [ ] Fixtures added under `packages/rules/soroban/tests/` mirroring `storage-rent-check.spec.ts`
