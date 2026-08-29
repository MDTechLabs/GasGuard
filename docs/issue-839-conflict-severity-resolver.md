# Optimization Conflict Severity Resolver (closes #839)

## Problem
Rules can recommend mutually exclusive fixes for the same code (e.g. a storage-layout rule under
`rules/security/storage-layout/` suggesting one packing order while an optimization rule under
`rules/optimization/storage/` suggests another). Today these conflicting recommendations are surfaced
with equal weight, giving the user no signal on which to trust.

## Design
- `packages/rules/soroban/src/conflicts/severity-resolver.ts`
  - Input: pairs/groups of findings already identified as touching the same location — reusing the
    `CorrelatedGroup` output from the finding correlator (#838) as the natural source of conflict
    candidates, plus each finding's existing `confidence` and `estimatedImpact` fields where a rule
    provides them (as `types.ts` in `packages/gas-estimator/stellar` already models numeric estimates).
  - `detectConflicts(group: CorrelatedGroup): ConflictPair[]` — flags findings within a group whose
    suggested fixes are mutually exclusive (e.g. differing target values for the same field/slot).
  - `resolveSeverity(pair: ConflictPair): ConflictSeverity` — compares `confidence` (higher wins) then
    `estimatedImpact` (higher wins on a tie), returning `{ severity: 'low'|'medium'|'high', winner, loser,
    reason }`.
  - `packages/rules/soroban/src/conflicts/severity-resolver.spec.ts` covering: confidence-decided case,
    impact-decided tie-break case, and an unresolvable tie (both fields equal) defaulting to `'high'`
    severity to force human review.
- Output: `ConflictSeverity.severity` is attached to the consolidated finding surfaced by the formatter
  (`packages/formatters/src/github-pr-formatter.ts`), replacing the current flat, unranked listing.

## Acceptance Criteria
- [ ] `detectConflicts` identifies mutually exclusive fixes within a correlated finding group.
- [ ] `resolveSeverity` factors in each finding's confidence score.
- [ ] `resolveSeverity` factors in each finding's estimated impact as a tie-breaker.
- [ ] Resolved severity is included in the analysis output consumed by the formatter.
