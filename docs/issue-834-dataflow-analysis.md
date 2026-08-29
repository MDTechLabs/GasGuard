# Soroban Dataflow Analysis (#834)

## Problem
Existing Soroban rules (e.g. `packages/rules/soroban/src/storage-rent-check.ts`,
`rules/stellar/optimization/detect-inefficient-symbol-usage.ts`) match local
regex patterns on single lines. They cannot detect optimizations that span
multiple statements — e.g. a value defined in one line, copied in another,
and never used in a third. This issue asks for a proper def-use dataflow
analyzer that #835 and #836 build their detections on top of.

## Prior Art In This Repo
- `src/analysis/state-graph/` (#833) already models storage reads/writes as a
  graph; dataflow analysis extends this to **local variables**, not just
  storage.
- `src/graphs/stellar/call-graph/call-graph-generator.ts` shows the existing
  pattern for a `*-generator.ts` class producing a typed graph with a
  `.spec.ts` alongside it — the dataflow analyzer should follow the same
  shape.

## Design
New module: `src/analysis/dataflow/` (`dataflow-analyzer.ts`, `types.ts`,
`dataflow-analyzer.spec.ts`).

**Types** (`src/analysis/dataflow/types.ts`):
```ts
export interface DefUseEntry {
  variable: string;
  definedAt: { line: number; functionName: string };
  uses: Array<{ line: number; kind: 'read' | 'arg' | 'return' }>;
  sourceKind: 'literal' | 'param' | 'storage-read' | 'call-result' | 'copy';
}
export interface DataflowResult {
  entries: DefUseEntry[];
  unusedDefinitions: DefUseEntry[]; // uses.length === 0
}
```

**Entry point:** `SorobanDataflowAnalyzer.analyze(source: string): DataflowResult`,
exported from `src/analysis/dataflow/index.ts`. Walks `let`/`let mut`
bindings, function parameters, and `return` statements using the same
line-scanning approach as `storage-rent-check.ts`, tracking simple
straight-line control flow (branches treated as separate paths, no loop
fixpoint required for v1 per the issue's "basic control-flow paths"
requirement).

## Acceptance Criteria
- [ ] `DataflowResult` produced per-function with defs and uses populated
- [ ] Variable definitions, uses, function args, and return values all tracked
- [ ] `unusedDefinitions` correctly flags a def with zero recorded uses
- [ ] `dataflow-analyzer.spec.ts` covers straight-line and simple branching code
