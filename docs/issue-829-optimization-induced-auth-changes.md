# Detect Optimization-Induced Authorization Changes

Closes #829

## Problem

Autofix transformations (e.g. loop unrolling, function inlining, storage
consolidation) can restructure a Soroban function body enough that a
`require_auth()` / `require_auth_for_args()` call is dropped, moved past an
early return, or applied to the wrong `Address` parameter. Today nothing in
the autofix pipeline verifies that the *set* of enforced authorization checks
is unchanged before a suggested fix is accepted.

## Design

Add a new rule module `packages/rules/src/security/authorization/`, mirroring
the existing per-category layout under `packages/rules/src/security/`
(`constructors/`, `signatures/`, `emergency/`). It contributes an
`AuthorizationDiffRule` implementing the `SorobanRule` trait consumed by
`SorobanRuleEngine::add_rule` in `packages/rules/src/soroban/rule_engine.rs`.

The rule runs twice: once against the pre-fix `SorobanContract` (from
`packages/rules/src/soroban/parser.rs`) and once against the autofix
candidate produced under `packages/autofix/validation/security/`. For each
`SorobanFunction` in `SorobanImpl.functions` it extracts the ordered list of
`require_auth`/`require_auth_for_args` call sites and the `Address` argument
each guards, then diffs the two lists per function name:

- an entry present before and absent after -> authorization removed
- a guard whose argument changed -> authorization scope changed
- a guard now reachable only after another branch/return -> ordering hazard

Diff results are emitted as `RuleViolation`s with
`ViolationSeverity::Critical` (via `crate::{RuleViolation, ViolationSeverity}`,
same pattern as `packages/rules/src/soroban/analyzer.rs`), which the autofix
validator in `packages/autofix/validation/security/` uses to reject the
candidate fix outright rather than merely warning.

## Acceptance Criteria

- [ ] `AuthorizationDiffRule` compares pre/post authorization call sites per function
- [ ] Removed, moved, or retargeted `require_auth*` calls are flagged
- [ ] Violations use `ViolationSeverity::Critical` and block the autofix, not just warn
- [ ] Rule is registered in `SorobanRuleEngine::with_default_rules`
- [ ] Regression fixtures cover: dropped auth, auth after early return, auth on wrong `Address`
