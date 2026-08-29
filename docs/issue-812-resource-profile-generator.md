# Soroban Resource Profile Generator (closes #812)

## Problem
Soroban rules currently emit independent findings (e.g. `packages/rules/soroban/src/storage-rent-check.ts`,
`packages/rules/soroban/src/analyzer/wasm-inspector.ts`). None of these give a reviewer a single view of a
contract's overall CPU/memory/storage footprint — each finding is a point observation, not a profile.

## Design
Add a new aggregation module, following the existing `packages/rules/soroban/src` layout:

- `packages/rules/soroban/src/resources/profile-generator.ts`
  - Exports `generateResourceProfile(findings: RuleFinding[]): ResourceProfile`, mirroring the
    result-object convention used by `rules/stellar/optimization/detect-inefficient-symbol-usage.ts`
    (`SymbolUsageResult`-style shape: typed fields + a human-readable `message`).
  - `ResourceProfile` fields: `cpuEstimate`, `memoryEstimate`, `storageImpact` (each aggregated from the
    per-finding estimates already produced by `storage-rent-check.ts` and `analyzer/wasm-inspector.ts`),
    plus `dominantCategory: 'cpu' | 'memory' | 'storage'` derived by comparing the three totals.
- `packages/rules/soroban/src/resources/profile-generator.spec.ts` for unit coverage, matching the
  sibling-spec pattern already used (`storage-rent-check.spec.ts`, `wasm-inspector.spec.ts`).
- Output wiring: extend `packages/formatters/src/github-pr-formatter.ts` (or a sibling formatter) to
  render the profile block in PR comments, alongside individual findings.

## Acceptance Criteria
- [ ] `generateResourceProfile` aggregates CPU, memory, and storage estimates across all findings for a
      single analyzed contract.
- [ ] Resource categories are summed/aggregated, not just listed per-finding.
- [ ] `dominantCategory` correctly identifies the largest contributor.
- [ ] Profile is attached to the existing analysis output object consumed by the formatters package.
