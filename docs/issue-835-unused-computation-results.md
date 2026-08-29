# Detect Unused Soroban Computation Results (#835)

## Problem
Contract functions sometimes compute a value (arithmetic, a method call, a
storage read) and bind it to a variable that is never subsequently read,
returned, or passed as an argument. Each such computation still consumes gas
on-chain with zero effect. This needs to be flagged as a lint rule, built on
top of the dataflow analyzer from #834.

## Prior Art In This Repo
- Rule shape: `packages/rules/soroban/src/storage-rent-check.ts` defines
  `SorobanStorageRentCheckRule` with a `public static readonly RULE_ID`
  and a `.analyze(sourceCode): Warning[]` method, registered via
  `packages/rules/soroban/src/index.ts` (`export * from './...'`).
- Warning shape: `StorageRentWarning` in the same file (`line`, `message`,
  `suggestion` fields) is the field convention this rule's output should
  match.

## Design
New file: `packages/rules/soroban/src/unused-computation-check.ts`,
registered by adding `export * from './unused-computation-check';` to
`packages/rules/soroban/src/index.ts`.

```ts
export interface UnusedComputationWarning {
  line: number;
  variable: string;
  message: string;
  suggestion: string;
}

export class SorobanUnusedComputationRule {
  public static readonly RULE_ID = 'soroban-unused-computation';
  public analyze(sourceCode: string): UnusedComputationWarning[] { /* ... */ }
}
```

**Inputs:** `DataflowResult` from `src/analysis/dataflow/` (#834), specifically
its `unusedDefinitions` list, filtered to `sourceKind !== 'param'` (function
parameters that go unused are a separate, existing concern) and
`sourceKind !== 'literal'` (cheap constants aren't worth flagging).
**Outputs:** one `UnusedComputationWarning` per unused non-trivial definition,
with `suggestion` telling the developer to remove the binding or use `let _ =`.

## Acceptance Criteria
- [ ] `SorobanUnusedComputationRule.RULE_ID = 'soroban-unused-computation'`
- [ ] Rule consumes `DataflowResult.unusedDefinitions`, not its own regex scan
- [ ] Storage reads and call-results with zero uses are reported; literals and
      unused fn params are excluded
- [ ] Each warning includes source `line` and an actionable `suggestion`
