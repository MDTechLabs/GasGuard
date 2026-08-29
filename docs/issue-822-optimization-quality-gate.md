# Soroban Optimization Quality Gate (#822)

## Problem
An automated optimization can reduce one resource metric (e.g. instruction
count) while silently regressing another, breaking compilation, or
reintroducing a security finding. Reducing a single metric is not sufficient
grounds to accept a transformation.

## Design
Introduce a quality gate that runs after `packages/autofix` produces a
candidate transformation and before it is applied, consuming the comparison
data described in `docs/issue-821-before-and-after-report.md` plus the
compilation/test results from #823 and #824.

Proposed layout:
- `packages/quality-gates/soroban/` — gate orchestration and checks.
- Reuses `packages/autofix` transformation output and `packages/benchmark`
  resource snapshots as inputs; does not duplicate their logic.

## Checks (each returns pass/fail with a reason)
1. **Resource improvement** — net resource delta from the before/after
   report must be non-negative (no metric regresses beyond a configurable
   tolerance).
2. **Analysis regressions** — no `rules/stellar/optimization` or
   `rules/security` findings present after the change that were absent
   before.
3. **Compilation status** — the compilation validator (#823) result must be
   success.
4. **Security findings** — no new/increased-severity findings from
   `rules/security/*`.

## Result
Gate returns an aggregate pass/fail plus the list of individual check
results, so callers (CLI, CI) can report exactly which check failed.

## Acceptance Criteria
- [ ] Quality gate implemented in `packages/quality-gates/soroban/`
- [ ] Resource improvements validated against before/after report
- [ ] Regressions detected via rule re-analysis
- [ ] Security findings considered as a blocking check
- [ ] Aggregate pass/fail result generated with per-check reasons
