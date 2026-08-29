# Cross-Rule Finding Correlator (closes #838)

## Problem
Distinct rules can flag the same underlying issue from different angles. For example,
`rules/stellar/optimization/detect-inefficient-symbol-usage.ts` and
`rules/stellar/optimization/loops/detect-inefficient-loop.ts` may both report findings that point at the
same function body, producing duplicate/overlapping recommendations for one root cause.

## Design
- `packages/rules/soroban/src/correlation/finding-correlator.ts`
  - Input: `RuleFinding[]` — the same finding shape already emitted by rules such as
    `detectInefficientSymbolUsage` and `storage-rent-check.ts` (each finding carries a source location
    and a `message`/`suggestion` pair per the existing convention).
  - `correlateFindings(findings: RuleFinding[]): CorrelatedGroup[]`
    - `groupByLocationOverlap`: buckets findings whose source ranges overlap or are adjacent within a
      configurable line-distance threshold.
    - `identifyRootCause`: within a bucket, picks a shared root-cause tag (e.g. `redundant-storage-write`,
      `repeated-allocation`) from a small static tag table keyed by rule id.
    - Returns `CorrelatedGroup { rootCause: string; findings: RuleFinding[]; consolidatedMessage: string }`.
- `packages/rules/soroban/src/correlation/finding-correlator.spec.ts` covering: no overlap (groups of 1),
  two overlapping findings from different rules, and three-way overlap.
- Consumers: the report generator that currently emits one entry per raw finding switches to iterating
  `CorrelatedGroup[]`, printing `consolidatedMessage` once per group instead of once per finding.

## Acceptance Criteria
- [ ] `correlateFindings` groups findings whose source locations overlap.
- [ ] Overlapping source locations across different rule ids are detected, not just within one rule.
- [ ] Grouped findings resolve to a shared root-cause tag.
- [ ] `finding-correlator.spec.ts` covers non-overlap, pairwise, and multi-way correlation cases.
