# Soroban State Dependency Graph (#833)

## Problem
Optimization and security rules currently reason about Soroban contract source
line-by-line. There is no structural model of how `env.storage()` reads,
writes, and the computations between them relate, so rules cannot tell
whether a write is derived from a prior read, or whether two storage keys
are correlated. This blocks safe, non-local optimizations (#834-#836 depend
on it).

## Prior Art In This Repo
- `src/analysis/dependency-graph/` builds a **contract-level** graph
  (`SorobanDependencyAnalyzer`) tracking cross-contract calls, not state.
- `src/graphs/stellar/call-graph/` (`CallGraph`, `CallGraphNode`) builds a
  **function-level** call graph — same layout to mirror at state level.
- `packages/rules/soroban/src/storage-rent-check.ts` parses storage calls
  line-by-line; the pattern the new analyzer feeds for storage-aware rules.

## Design
New module: `src/analysis/state-graph/` (sibling to `dependency-graph/`,
following the same `index.ts` + `types.ts` + `*.spec.ts` layout).

**Types** (`src/analysis/state-graph/types.ts`):
```ts
export interface StateNode {
  id: string; kind: 'read' | 'write' | 'computation';
  storageType?: 'persistent' | 'instance' | 'temporary';
  key?: string; functionName: string; line: number;
}
export interface StateEdge {
  source: string;
  target: string;
  kind: 'reads-into' | 'writes-from' | 'computed-from';
}
export interface StateDependencyGraph {
  nodes: StateNode[];
  edges: StateEdge[];
}
```

**Entry point:** `StateDependencyGraphBuilder.build(filePath, source): StateDependencyGraph`,
exported from `src/analysis/state-graph/index.ts`, consumed by
`packages/rules/soroban/src/` rules and by the dataflow analyzer in #834.

## Acceptance Criteria
- [ ] `StateDependencyGraph` type and builder exist under `src/analysis/state-graph/`
- [ ] Reads (`.get`) and writes (`.set`) become distinct node kinds
- [ ] Edges connect writes to the reads/computations they depend on per function
- [ ] Graph object is importable by rule modules (no CLI/reporting coupling)
