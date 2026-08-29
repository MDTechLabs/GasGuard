# Soroban Optimization Audit Trail

Closes #826

## Problem

When GasGuard's autofix engine (`packages/autofix/`) suggests or applies a
Soroban optimization, there is currently no persistent record of which rule
fired, what changed, how confident the engine was, or whether validation
(see #825, #828) passed. Maintainers reviewing a PR, or auditing history
later, have no single source of truth for "why was this code changed."

## Design

Add an audit-trail package that autofix writes to on every recommendation:

- **Location**: `packages/audit/soroban/optimization/` (new package),
  written to by `packages/autofix/` and read by `packages/reporting/` for
  presentation (following the existing pattern documented in
  `docs/AUDIT_LOGGING_SYSTEM.md`, which already logs API/key events).
- **Record shape**, one per optimization attempt:
  - `ruleId` — e.g. `g008_sload_in_loop`, matching identifiers used under
    `rules/optimization/`
  - `sourceDiff` — the before/after source change
  - `confidenceScore` — the rule engine's confidence in the fix
  - `behaviorGuardResult` — pass/fail + divergence details from #825
  - `securityGuardResult` — pass/fail + findings from #828
  - `timestamp` — ISO 8601, when the recommendation was generated
- **Storage**: append-only, following the immutable-log approach already
  used by `docs/AUDIT_LOGGING_SYSTEM.md`, keyed by contract + rule + commit.
- **Retrieval**: `packages/reporting/` exposes records filterable by rule,
  contract, and date range, for CLI/PR-comment rendering.

## Acceptance Criteria

- [ ] `packages/audit/soroban/optimization/` records rule id, source diff,
      confidence score, and validation results for every optimization
      attempt (not just applied ones).
- [ ] Records are append-only and timestamped.
- [ ] `packages/reporting/` can retrieve records filtered by rule and
      contract.
- [ ] Rejected optimizations (from #825/#828) are recorded with their
      rejection reason, not silently dropped.
