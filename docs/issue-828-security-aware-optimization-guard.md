# Soroban Security-Aware Optimization Guard

Closes #828

## Problem

A gas/resource optimization that touches authorization checks or state
mutation ordering can silently weaken contract security even though it
"passes" a pure resource-cost improvement check. GasGuard already has
dedicated security rule sets (`rules/security/access-control/`,
`rules/security/initialization/`, `rules/security/storage-layout/`, etc.)
but the autofix engine does not currently cross-check its own generated
patches against them.

## Design

- **Location**: `packages/autofix/soroban/security/` (new package),
  consumed by the autofix orchestrator before a patch is finalized, and
  cross-checked against the existing rule set under `rules/security/`.
- **Sensitive-change detection**: classify a candidate patch as
  security-sensitive if the diff touches:
  - authorization checks (`require_auth`/`require_auth_for_args` call
    sites, matching intent of `rules/security/access-control/`)
  - initialization/constructor guards (`rules/security/initialization/`)
  - storage key layout or ordering (`rules/security/storage-layout/`)
- **Blocking rule**: if a patch is security-sensitive AND the resulting
  code fails the corresponding existing security rule (re-run from
  `rules/security/`), the patch is rejected outright — it is never offered
  as an autofix suggestion, regardless of its resource savings.
- **Reporting**: every security-sensitive patch (accepted or rejected)
  writes a `securityGuardResult` entry consumed by the audit trail package
  from #826, including which specific security rule was checked and its
  pass/fail outcome.

## Acceptance Criteria

- [ ] `packages/autofix/soroban/security/` flags patches that touch
      authorization or state-management logic.
- [ ] Flagged patches are re-validated against the relevant existing rules
      in `rules/security/`.
- [ ] Any patch that fails that re-validation is blocked from being
      suggested, independent of its resource-savings score.
- [ ] Security validation results are reported per patch (rule checked +
      pass/fail), consumable by the audit trail in #826.
