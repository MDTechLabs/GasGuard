# Issue #843: GasGuard Pull Request Analysis

## Problem

Developers only see optimization/security feedback when they run GasGuard
locally or in a separate CI step. There is no path from an open pull request
straight to review-time findings, even though the building blocks
(diffing, formatting) already exist independently.

## Design

Add a new integration module at `src/integrations/github/` (mirroring the
existing `src/integrations/wallets/` sibling) plus
`src/api/integrations/github/` for the NestJS-facing endpoint, and tests
under `tests/integrations/github/`, per the issue's stated scope. This
module composes two pieces that already exist rather than reimplementing
them:

1. **Changed-file detection & diffing** — reuse
   `src/analysis/diff/code-diff-analyzer.ts`, which already produces
   `CodeDiff`, `GasImpactDiff`, and `SecurityDiff` (the latter two are also
   the foundation for #841/#842) from a `DiffAnalysisResult`.
2. **Review comment formatting** — reuse
   `packages/formatters/src/github-pr-formatter.ts`, which already turns a
   `GasDiagnostic[]` into a Markdown table via `calculateTotalSavings` and
   the `COLLAPSE_THRESHOLD`-gated formatter, ready to post as a PR comment.

New surface area is limited to: fetching the PR's changed files via the
GitHub API, running each changed Soroban/Solidity/Vyper file through the
existing analyzer pipeline (`src/analysis/pipeline`) against the baseline
from #840, and mapping `DiffAnalysisResult` into `GasDiagnostic[]` for the
formatter.

- **Inputs**: PR number/repo ref (via `@octokit`-style client).
- **Outputs**: posted PR comment (Markdown) + structured `DiffAnalysisResult`
  returned to the caller for the `src/api` review workflow.

## Acceptance Criteria

- [ ] Changed contract files (Soroban/Solidity/Vyper) are detected from a PR diff
- [ ] Each changed file is analyzed and compared against baseline via existing diff/formatter modules
- [ ] Findings are returned in a shape consumable by the existing review workflow
- [ ] No duplication of `CodeDiff`/`GasImpactDiff`/`SecurityDiff` or the PR formatter logic
