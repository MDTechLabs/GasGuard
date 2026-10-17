# Public Release Checklist

This is the checklist every GasGuard release runs through. Copy the
[Checklist](#checklist) section into the release PR or tracking issue and check
items off with links to evidence (CI run, dashboard, or document). Complete all
pre-release checks and record every sign-off before tagging; complete the
post-release section after publication.

For the one-time mainnet launch specifically, also see
[PRODUCTION_READINESS_REVIEW.md](PRODUCTION_READINESS_REVIEW.md), which
tracks the launch-blocker issues themselves. This checklist is the repeatable
process every release (mainnet launch or later patch) goes through.

## Checklist

### 1. Tests

- [ ] `npm test` (Jest unit/integration suite) passes locally and in CI
- [ ] `npm run test:e2e` passes
- [ ] `npm run test:regression` (Stellar security regression corpus, [#981](https://github.com/MDTechLabs/GasGuard/issues/981)/[#982](https://github.com/MDTechLabs/GasGuard/issues/982)) passes
- [ ] `npm run test:contracts` (Hardhat) passes
- [ ] `cargo test` passes for the Rust analyzer engine (`libs/engine`)
- [ ] CI is green on the release commit: **Rust Tests**, **Node.js Lint**, **Node.js Build**, **Stellar Security Regression** (`.github/workflows/ci.yml`)
- [ ] `npm run bench:gas-comparator` shows no unexplained regression vs. the last release's benchmark numbers ([#983](https://github.com/MDTechLabs/GasGuard/issues/983))

### 2. Security review

- [ ] **Secret Scanning** (Gitleaks) job green on the release commit
- [ ] **Dependency & Supply-Chain Audit** job green (`npm audit`, `cargo audit`)
- [ ] **Artifact Checksums** job green and SHA-256 checksums published for release artifacts ([#978](https://github.com/MDTechLabs/GasGuard/issues/978))
- [ ] Analyzer output is verified deterministic for this build ([#967](https://github.com/MDTechLabs/GasGuard/issues/967))
- [ ] No open Critical/High findings from GasGuard's own self-scan (`gasguard-scan.yml` / `gasguard.yml`) on the release branch
- [ ] Security sign-off recorded below by someone outside the PR author's team

### 3. Migrations

- [ ] **Migration Safety** workflow (`.github/workflows/migration-safety.yml`) is green: `node scripts/check-migrations.mjs`
- [ ] Any destructive migration in this release has `ALLOW_DESTRUCTIVE_MIGRATIONS=true` set deliberately and reviewed — see [MIGRATION_SAFETY.md](MIGRATION_SAFETY.md)
- [ ] Migration has been run against a staging copy of production data and the diff reviewed
- [ ] Backup taken immediately before migration, per [DATABASE_BACKUP_RESTORE.md](DATABASE_BACKUP_RESTORE.md)
- [ ] Rollback SQL/migration-down path has been tested, not just written

### 4. Monitoring

- [ ] `/health`, `/health/ready`, `/health/live` respond correctly post-deploy ([#959](https://github.com/MDTechLabs/GasGuard/issues/959))
- [ ] `/dashboard/metrics` reflects live traffic on the new version ([#998](https://github.com/MDTechLabs/GasGuard/issues/998))
- [ ] `/alerting/rules` and `/alerting/oncall/:service` show correct on-call ownership for this release window ([#999](https://github.com/MDTechLabs/GasGuard/issues/999))
- [ ] Distributed tracing / metrics pipeline is receiving data from the new version ([#985](https://github.com/MDTechLabs/GasGuard/issues/985))
- [ ] `/staging-parity/check` shows no drift between staging and the config being promoted ([#1000](https://github.com/MDTechLabs/GasGuard/issues/1000))
- [ ] Audit logging is capturing privileged actions on the new version ([#997](https://github.com/MDTechLabs/GasGuard/issues/997))

### 5. Rollback

- [ ] Previous release's artifact/image tag is identified and still pullable
- [ ] Rollback procedure is written down (deploy previous tag, restore migration-down if one ran) and the person on call for this release has read it
- [ ] Redis failure/recovery behavior reviewed if this release touches caching or queues — see [REDIS_FAILURE_RECOVERY.md](REDIS_FAILURE_RECOVERY.md)
- [ ] Queue retry / dead-letter handling verified for any job changes in this release ([#986](https://github.com/MDTechLabs/GasGuard/issues/986))
- [ ] Graceful shutdown and job draining confirmed working on the new version before the old version is terminated ([#987](https://github.com/MDTechLabs/GasGuard/issues/987))
- [ ] A rollback has been rehearsed (not just documented) within the last two releases

### 6. Sign-off

No release ships until every row below is filled in by the named person, not on their behalf.

| Area | Approver | Decision | Date |
|---|---|---|---|
| Engineering (owns the change) | | | |
| Security review | | | |
| Operations / on-call | | | |
| Release manager (final go) | | | |

### 7. Post-release verification

Complete these checks after publication and record the evidence in the release
tracking issue. A failure requires a release-manager decision on remediation,
rollback, or a corrected release.

- [ ] `CLI Release Builds` completed and all expected platform binaries and
	Sigstore signature bundles are attached to the release
- [ ] `release-smoke` passed for Linux x64, macOS x64, macOS arm64, and Windows
	x64; the published binaries' `--help` and `version` commands both ran
- [ ] GitHub build provenance attestations can be verified for each published
	CLI executable; see [RELEASE_ARTIFACT_POLICY.md](RELEASE_ARTIFACT_POLICY.md)
- [ ] Release SBOM workflow completed and its expected SBOM files are attached
- [ ] Published announcement is accurate, links to the release and relevant
	upgrade/security notes, and contains no secrets or private production data
- [ ] Production health checks, error rates, and service metrics are normal
	after deployment; record the observation window and dashboard or CI evidence
- [ ] Any regression, failed smoke check, or unexpected operational signal has
	an owner and tracked follow-up; escalate rollback decisions to the release
	manager

## Notes

- This checklist is intentionally generic so it applies to every release, not just the first mainnet launch. Update it as new CI jobs or operational tooling are added — if a checklist item's evidence source moves or is renamed, fix the link here in the same PR.
- If any pre-release box can't be checked, the release does not proceed until it's fixed or the release manager explicitly accepts the risk in writing in the sign-off table.
- Post-release checks are necessarily completed after publication; keep the release under active observation until those checks and any required decisions are recorded.
