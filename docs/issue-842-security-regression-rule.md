# Issue #842: Soroban Security Regression Rule

## Problem

Optimization passes over Soroban contracts (rules under `rules/stellar/security/`
and `rules/stellar/security/unsafe-operations/`) can introduce vulnerabilities
that were not present in the prior version. There is currently no rule that
diffs security findings between two analysis runs.

## Design

Add rule id **`soroban-security-regression`** under
`packages/rules/soroban/src/regression/security-regression.ts`. Rather than
inventing a new diff shape, this rule is a thin consumer of the
`SecurityDiff` interface already declared in
`src/analysis/diff/code-diff-analyzer.ts`:

```ts
interface SecurityDiff {
  filePath: string;
  newVulnerabilities: Finding[];
  fixedVulnerabilities: Finding[];
  unchangedVulnerabilities: Finding[];
  riskLevelChange: 'improved' | 'degraded' | 'unchanged';
}
```

- **Inputs**: current security findings (from the `rules/stellar/security/*`
  and `rules/security/*` detectors, e.g. `detect-unsafe-low-level-calls.ts`)
  plus the baseline record from #840.
- **Matching**: findings are matched between runs by rule id + file + normalized
  line range so relocated-but-unchanged findings land in
  `unchangedVulnerabilities` rather than being double-counted as new.
- **Severity assignment**: `newVulnerabilities` inherit each finding's own
  `ViolationSeverity` (Rust side, `packages/rules/src`) or `Severity`
  (`@engine/core`, TS side); the rule additionally assigns a regression-level
  tag (`critical-regression` / `regression`) when `riskLevelChange ===
  'degraded'`.
- **Output**: a `SecurityDiff` per changed file plus an aggregate regression
  verdict for the contract.

## Acceptance Criteria

- [ ] Rule registered with id `soroban-security-regression`
- [ ] New findings absent from baseline are detected and reported
- [ ] Findings present in baseline but absent from current run are tracked as resolved
- [ ] Each regression is assigned a severity derived from the underlying finding's severity plus risk-level change
