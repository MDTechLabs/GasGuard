# Soroban Rule Dependency Graph (closes #837)

## Problem
Some Soroban rules need output from other rules before they can run — e.g. a resource-profile style rule
(see #812) needs findings from `packages/rules/soroban/src/storage-rent-check.ts` and
`packages/rules/soroban/src/analyzer/wasm-inspector.ts` already computed. Today rules in
`packages/rules/soroban/src/index.ts` are invoked with no ordering guarantee.

## Design
- `packages/rules/soroban/src/dependency-graph.ts`
  - `RuleDependency { rule: string; dependsOn: string[] }` — declared per rule module, keyed by the same
    rule-id strings already used when registering rules in `index.ts`.
  - `buildDependencyGraph(deps: RuleDependency[]): DependencyGraph` — adjacency-list build.
  - `validateGraph(graph: DependencyGraph): ValidationResult` — checks every `dependsOn` entry references
    a registered rule id.
  - `detectCycles(graph: DependencyGraph): string[][]` — DFS-based cycle detection, returning offending
    cycles as arrays of rule ids (empty array = acyclic).
  - `resolveExecutionOrder(graph: DependencyGraph): string[]` — topological sort (Kahn's algorithm),
    throwing a descriptive error if `detectCycles` found a cycle first.
- `packages/rules/soroban/src/dependency-graph.spec.ts` covering: linear chain, diamond dependency,
  self-cycle, and a two-node cycle.
- Integration point: `index.ts`'s rule runner calls `resolveExecutionOrder` once at startup and iterates
  rules in that order instead of the current registration order.

## Acceptance Criteria
- [ ] Rule dependency graph data structure implemented (`RuleDependency` + `DependencyGraph`).
- [ ] `validateGraph` rejects a dependency on an unregistered rule id.
- [ ] `detectCycles` correctly flags circular dependencies (including self-references).
- [ ] `resolveExecutionOrder` produces a valid topological ordering consumed by the rule runner.
