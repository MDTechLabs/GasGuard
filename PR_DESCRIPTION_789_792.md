# Soroban Analysis Infrastructure (#789, #790, #791, #792)

Implements four infrastructure features for the **Stellar Wave** scope, all
delivered on one branch:

| Issue | Title | Implementation |
|-------|-------|----------------|
| #789  | Soroban Optimization Confidence Scoring | `packages/analyzers/soroban/confidence/confidence-scorer.ts` |
| #790  | Soroban Safe Auto-Fix Framework | `packages/autofix/soroban/safe-auto-fix.ts` |
| #791  | Rust AST Parser Integration | `packages/parsers/rust/rust-ast-parser.ts` |
| #792  | Soroban AST Node Visitor Framework | `packages/analyzers/soroban/ast/visitor.ts` |

## Overview

These modules form a layered pipeline for Soroban analysis:

1. **#791 Rust AST Parser** — parses Rust (Soroban subset) source into a
   structured AST (`modules`, `structs`, `impls`, `functions`, `params`,
   `calls`, `storageOps`), preserving 1-based line numbers and byte offsets for
   every node. Parse failures never panic; diagnostics are returned with the
   AST.
2. **#792 AST Visitor Framework** — reusable visitors over that AST
   (contract / impl / function / param / call / storage-op hooks) plus a
   `VisitorRegistry` so rules can register their own visitors without
   implementing traversal logic.
3. **#789 Confidence Scoring** — 0–1 confidence scores for recommendations
   based on rule reliability, code context, and evidence strength, mapped to
   `high` / `medium` / `low` levels with a human-readable rationale.
4. **#790 Safe Auto-Fix Framework** — pluggable fix providers keyed by rule id,
   applicability validation, dry-run previews with unified diffs,
   confidence-threshold gating, and formatting-preserving single-line edits.

## Acceptance criteria

- [x] **#789** Confidence scoring implemented; confidence levels defined;
      scores included in findings; scoring tests added.
- [x] **#790** Auto-fix framework implemented; fix providers supported;
      dry-run mode available; formatting preserved.
- [x] **#791** Rust AST parser integrated; AST accessible to analyzers; parse
      errors handled; source locations preserved.
- [x] **#792** Visitor framework implemented; common AST nodes supported;
      rules can register visitors; visitor tests added.

## Files changed

- `packages/parsers/rust/rust-ast-parser.ts` + `__tests__/rust-ast-parser.spec.ts` (#791)
- `packages/analyzers/soroban/ast/visitor.ts` + `__tests__/visitor.spec.ts` (#792)
- `packages/analyzers/soroban/confidence/confidence-scorer.ts` + `__tests__/confidence-scorer.spec.ts` (#789)
- `packages/autofix/soroban/safe-auto-fix.ts` + `__tests__/safe-auto-fix.spec.ts` (#790)

## Verification

```bash
npx jest --testPathPattern='packages/(parsers/rust|analyzers/soroban/ast|analyzers/soroban/confidence|autofix/soroban)' --no-coverage
# → 4 suites, 27 tests, all passing
```

The implementations follow the conventions of the existing Soroban analyzers
(e.g. `call-frequency-analyzer.ts`, `optimization-preview.ts`): TypeScript,
pure functions, findings-based output, Jest specs in `__tests__/`.

This PR resolves #789, #790, #791, and #792.