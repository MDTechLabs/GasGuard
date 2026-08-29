# Detect Unnecessary Soroban Variable Copies (#836)

## Problem
Rust/Soroban code sometimes clones or reassigns a value into a new binding
that is used only once, immediately after, in place of the original
(`let b = a.clone(); do_thing(b);` where `a` is otherwise unused after). This
adds avoidable clone/copy overhead. The detector must be conservative: types
with real ownership semantics (`Address`, moved `Vec`/`Map`/`Bytes`) must not
be flagged unless the copy is provably redundant, per the issue's explicit
"avoid ownership-related false positives" requirement.

## Prior Art In This Repo
- Rule shape and registration follow `packages/rules/soroban/src/storage-rent-check.ts`
  / `packages/rules/soroban/src/index.ts`, same as #835.
- Data source: the def-use chains from `src/analysis/dataflow/` (#834) —
  a "copy chain" is simply a `DefUseEntry` whose `sourceKind === 'copy'`
  (i.e. `let x = y;` or `let x = y.clone();`) where the source variable `y`
  has no further uses after the copy point.

## Design
New file: `packages/rules/soroban/src/unnecessary-copy-check.ts`, registered
via `packages/rules/soroban/src/index.ts`.

```ts
export interface UnnecessaryCopyWarning {
  line: number;
  copiedVariable: string;
  originalVariable: string;
  message: string;
  suggestion: string;
}

export class SorobanUnnecessaryCopyRule {
  public static readonly RULE_ID = 'soroban-unnecessary-copy';
  public analyze(sourceCode: string): UnnecessaryCopyWarning[] { /* ... */ }
}
```

**Detection rule (conservative v1):** only flag `let x = y.clone();` /
`let x = y;` where (a) `y` has no uses in the dataflow graph after the copy
line within the same function, and (b) `y`'s type is not one of the
Soroban-owned handle types (`Address`, `Env`, `BytesN`) obtained from a
function parameter — parameters are excluded entirely for v1 to avoid
ownership false positives, matching the issue's explicit acceptance bar.

## Acceptance Criteria
- [ ] `SorobanUnnecessaryCopyRule.RULE_ID = 'soroban-unnecessary-copy'`
- [ ] Copy chains derived from `src/analysis/dataflow/` def-use data, not regex
- [ ] Function-parameter-sourced values are never flagged (false-positive guard)
- [ ] `.spec.ts` covers a flagged clone-then-unused case and a not-flagged reused case
