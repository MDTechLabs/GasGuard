# Soroban Optimization Compilation Validator (#823)

## Problem
Automated source transformations produced by `packages/autofix` can
introduce syntax or type errors in the rewritten Rust contract. Nothing
today confirms an optimized contract still compiles before it is offered
back to the developer.

## Design
Add a compilation validator invoked by `packages/autofix` immediately after
a candidate transformation is generated, using the existing Rust toolchain
integration point.

Proposed layout:
- `packages/autofix/validation/compile/` — validator entry point, invoked
  per candidate fix.
- `packages/integrations/rust/` — thin wrapper around the Rust compiler
  invocation (`cargo check` against the Soroban contract's crate), kept
  separate so other validators (e.g. #824's test runner) can reuse it
  instead of shelling out independently.

## Flow
1. Write the transformed source to a temporary build directory alongside
   the contract's existing `Cargo.toml`.
2. Invoke the compiler check via `packages/integrations/rust`.
3. Capture stdout/stderr and exit code; parse diagnostics into structured
   `{ file, line, column, message, level }` records rather than raw text.
4. If exit code is non-zero, mark the transformation rejected and attach
   the diagnostics to the autofix result so `packages/quality-gates/soroban`
   (#822) can block it.

## Acceptance Criteria
- [ ] Compilation validator implemented in `packages/autofix/validation/compile/`
- [ ] Optimized contracts compiled via `packages/integrations/rust`
- [ ] Compiler failures detected and diagnostics preserved in structured form
- [ ] Failed transformations rejected before reaching the quality gate
