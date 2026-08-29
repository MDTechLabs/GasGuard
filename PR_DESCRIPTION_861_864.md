# Soroban Interface & Call-Safety Rules (#861, #862, #863, #864)

## Overview

Implements four new Soroban static-analysis rules under the **Stellar Wave** scope. All four rules live in a single new module, `packages/rules/src/soroban/interface_rules.rs`, are registered in the default `SorobanRuleEngine`, and ship with unit tests.

The referenced issue paths (`packages/analyzers/soroban/*`) do not exist in this repository; the Soroban rules live in `packages/rules/src/soroban/`, so the analyzer behavior is implemented as `SorobanRule` implementations following the existing conventions (e.g. `GovernanceVotingRule`, `SecureRandomnessRule`).

## Issues addressed

| Issue | Title | Rule ID |
|-------|-------|---------|
| #861  | Detect Unvalidated Soroban Contract Addresses | `soroban-unvalidated-contract-address` |
| #862  | Detect Unsafe Soroban Contract Call Targets | `soroban-unsafe-call-target` |
| #863  | Implement Soroban Contract Interface Analyzer | `soroban-interface-consistency` |
| #864  | Detect Inefficient Soroban Contract Interface Parameters | `soroban-inefficient-interface-params` |

## Rule details

### #861 — Unvalidated Contract Address (`soroban-unvalidated-contract-address`)

- Detects `Address`-typed parameters flowing into an `invoke_contract` / `invoke_contract_checked` / `invoke_function` call.
- Flags when the containing function does not validate the target (allow-list, `is_contract`, or `require_auth`/`require_auth_for` guards).
- **Severity:** High

### #862 — Unsafe Call Target (`soroban-unsafe-call-target`)

- Detects contract calls whose target is selected at runtime (an `Address`/`BytesN` parameter used directly in an invoke).
- Tracks parameter origin and only suppresses findings when an authorization/allow-list guard constrains the path.
- **Severity:** High

### #863 — Interface Consistency (`soroban-interface-consistency`)

- Reuses the parser's `SorobanImpl` / `SorobanFunction` surface to analyze public interface consistency.
- Flags state-mutating methods (`transfer`, `withdraw`, `deposit`, `mint`, `burn`, `claim`) that do not return `Result`, and public methods that rely on `panic!` instead of returning a `Result`.
- **Severity:** Info (Medium for the specific inconsistency findings)

### #864 — Inefficient Interface Parameters (`soroban-inefficient-interface-params`)

- Analyzes public function parameters for large/composite types.
- Flags unbounded container parameters (`Vec`, `Map`, `Set`, `Bytes`, `BytesN`) that inflate serialization cost.
- Detects duplicated parameter names (a serialization/ABI hazard).
- **Severity:** Info (Medium for duplicated-parameter findings)

## Files changed

- `packages/rules/src/soroban/interface_rules.rs` — new module with the four rules + 8 unit tests.
- `packages/rules/src/soroban/mod.rs` — module declaration and re-export.
- `packages/rules/src/soroban/rule_engine.rs` — imports the new rules and registers them in `add_default_rules()`; extends the engine-creation test.
- `Cargo.lock` — syncs the `gasguard-rules` dependency list with `Cargo.toml` (adds `gasguard-ast`).

## Acceptance criteria

- [x] Large parameters detected (#864)
- [x] Composite types analyzed (#864)
- [x] Findings generated (#863, #864)
- [x] Tests added
- [x] Dynamic targets detected (#862)
- [x] Target sources analyzed (#862)
- [x] Risk findings generated (#862)
- [x] Unvalidated addresses detected (#861)
- [x] Address sources tracked (#861)
- [x] Findings include source locations (#861)
- [x] Security tests added (#861)

## Verification

```bash
cargo test -p gasguard-rules soroban
# → 17 passed, 0 failed
```

All pre-existing Soroban tests continue to pass alongside the 8 new tests for these rules.