# Soroban Optimization CI Quality Gate

Closes #827

## Problem

Soroban resource analysis today runs on demand (CLI / manual scan). Nothing
stops a resource-cost regression from merging into `main` when a
contributor doesn't run the scan locally. This mirrors the Solidity path
already covered by `.github/workflows/gasguard-scan.yml`, but no equivalent
exists for Soroban.

## Design

This is a **design doc only** — no workflow file is added or modified as
part of closing this issue.

- **Location**: `packages/ci/soroban/` (new package) providing a CLI
  entrypoint that wraps the existing `rules/optimization/` and
  `rules/security/` rule sets for Soroban contracts, plus
  `packages/quality-gates/soroban/` for threshold evaluation.
- **Reference integration point**: `.github/workflows/gasguard-scan.yml`
  (Solidity today) and `.github/workflows/ci.yml` (Rust engine tests) show
  the existing pattern — pnpm install, build, then a scan step that writes
  to a `gasguard-results/` directory. A future Soroban job would follow the
  same shape: checkout, install, run `packages/ci/soroban/` against changed
  `.rs` contract sources, write JSON results.
- **Thresholds**: `packages/quality-gates/soroban/` reads a repo-level
  config (e.g. max allowed resource-cost delta per contract) and compares
  it against scan output; a "critical" classification fails the gate.
- **Output**: machine-readable JSON (for the gate) plus a human-readable
  summary suitable for a PR comment, matching the existing scan-results
  convention in `gasguard-scan.yml`.

## Acceptance Criteria

- [ ] `packages/ci/soroban/` can run the Soroban rule set headlessly and
      emit machine-readable JSON results.
- [ ] `packages/quality-gates/soroban/` supports configurable per-project
      thresholds for resource-cost regressions.
- [ ] A regression above the configured threshold is classified critical
      and would fail a CI job if wired up (actual workflow wiring is
      tracked separately, not part of this doc).
- [ ] Results are structured for pull-request reporting (summary +
      per-contract breakdown).
