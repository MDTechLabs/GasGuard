# Package Maintainer Change Signals

Part of the **Supply Chain** workstream.

Many supply-chain compromises start with a change in who controls a package:
a maintainer hands the package to a stranger, an attacker takes over an
account whose email domain expired, or a version is published by someone who
was never a maintainer before. GasGuard records who maintains each dependency
of a scanned repository and, on later scans of the same repository, reports
these changes as **signals** on the scan.

Code: [`apps/api/src/maintainer-signals/`](../apps/api/src/maintainer-signals).
Related: [SBOM ingestion](./SBOM_INGESTION.md), which can supply the package
list.

## Signals

| Type | Default severity | Fires when |
|---|---|---|
| `OWNERSHIP_TRANSFERRED` | high | Every baseline maintainer is gone and someone else now maintains the package. Replaces the added/removed signals for that change. |
| `PUBLISHED_BY_NEW_MAINTAINER` | medium | The scanned version was published by an account that was not a maintainer in the baseline. Needs a version and a registry that reports publishers. |
| `MAINTAINER_EMAIL_DOMAIN_CHANGED` | medium | A maintainer kept their handle but their email domain changed (a common sign of account takeover through an expired domain). Needs a registry that exposes emails. |
| `MAINTAINER_ADDED` | low | Maintainers appear that were not in the baseline (and it is not a full transfer). |
| `MAINTAINER_REMOVED` | low | Baseline maintainers are gone (and it is not a full transfer). Losing *every* maintainer is reported as removal. |

### Baselines

A **baseline** is the maintainer set last observed for a package, kept per
`(tenant, repository, ecosystem, package)`.

- The first time a repository's scan sees a package, GasGuard records a
  baseline and reports no signal, because there is no history to compare
  against. It is counted in `stats.baselined`.
- Each later scan compares against the baseline, reports any signals, and then
  replaces the baseline. A change is therefore reported **once**, on the first
  scan that sees it, and not again on later scans.
- Baselines are never shared between tenants or repositories. If two tenants
  depend on the same public package, each has its own history.

## Supported runtimes and inputs

| Ecosystem (purl type) | Registry | Maintainers from | Publisher | Emails |
|---|---|---|---|---|
| `npm` | registry.npmjs.org (or a compatible mirror via `baseUrl`) | `maintainers` in the version manifest `/<name>/<version>` (`/latest` without a version) | `_npmUser` | yes |
| `cargo` | crates.io | `/api/v1/crates/<name>/owners` (users and teams) | `published_by` of `/api/v1/crates/<name>/<version>` | no, so domain-change signals never fire for cargo |

Packages from other ecosystems (`pypi`, `maven`, `golang`, …) are not looked
up. They are listed in the report as skipped with `UNSUPPORTED_ECOSYSTEM`; this
is not an error. To add an ecosystem, implement `MaintainerRegistryProvider`,
pass it in `providers`, and add its purl type to `supportedEcosystems`.

Runtime: Node.js 18 or later, for the global `fetch` and `AbortController`. CI
and local verification use Node 22. Air-gapped deployments can pass
`StaticMaintainerProvider` instances, or their own providers backed by a
registry mirror.

Packages are supplied either:

- **explicitly**, as `packages: [{ ecosystem, name, version? }]`, or
- **from the scan's ingested SBOM** (`fromSbom: true`). Components are mapped
  through their purl; components without a purl have no reliable ecosystem
  and are left out. npm scopes are kept (`pkg:npm/%40scope/name` becomes
  `@scope/name`), and purl qualifiers are ignored.

The package list is normalized before use: ecosystems are lower-cased, entries
are de-duplicated by `(ecosystem, name)` (when versions differ, the
lexicographically lowest one is kept), and the list is sorted. The same input
in any order produces the same job and the same report.

## Public interface

```ts
import {
  MaintainerSignalService,
  MaintainerSignalWorker,
  FileMaintainerSignalStore,
  defaultMaintainerProviders,
  loadMaintainerSignalConfigFromEnv,
} from "./maintainer-signals";

const service = new MaintainerSignalService({
  store: new FileMaintainerSignalStore("/var/lib/gasguard/maintainer-signals"),
  providers: defaultMaintainerProviders(),      // optional; this is the default
  sbomSource: async (tenantId, repositoryId, scanId) =>
    (await sbomService.getResult(tenantId, repositoryId, scanId))?.sbom,
  config: loadMaintainerSignalConfigFromEnv(),
});

// API layer
const { jobId, status } = await service.submit({
  tenantId, repositoryId, scanId,
  fromSbom: true,                               // or: packages: [...]
});

// Worker process
const worker = new MaintainerSignalWorker(service, { workerId: "worker-1" });
worker.start();                                 // await worker.stop() on shutdown

// Reporting layer
service.getJob(tenantId, jobId);                // undefined for another tenant's job
await service.getReport(tenantId, repositoryId, scanId);
service.metricsText();                          // Prometheus exposition
```

`submit` does only cheap checks (identifiers, input shape, package count,
capacity, duplicates). Registry lookups happen on the worker.

### Report

```ts
{
  schemaVersion: 1,
  tenantId, repositoryId, scanId, jobId,
  revision: 7,                       // submission sequence
  analyzedAt: 1760000000000,
  status: "complete" | "partial",    // partial: some lookups failed (see below)
  signals: [{
    type: "OWNERSHIP_TRANSFERRED",
    severity: "high",
    ecosystem: "npm",
    package: "left-pad",
    version: "1.3.0",                // when known
    handles: ["mallory"],            // registry handles involved, sorted
    baselineObservedAt: 1759000000000,
  }],
  skipped: [{ ecosystem, package, reason }],   // first maxReportedSkips
  stats: { packages, compared, baselined, changed, skipped, lookupFailures },
}
```

Signals are sorted by severity (highest first), then ecosystem, package, and
type. Skipped packages are sorted by ecosystem and package. Severities below
`minSeverity` are left out of `signals`, but the package is still counted in
`stats.changed`.

Skip reasons: `UNSUPPORTED_ECOSYSTEM`, `NOT_FOUND` (the registry does not know
the package; it may be private or removed), `INVALID_METADATA` (malformed
response, unexpected 4xx, more than `maxMaintainersPerPackage` maintainers, or
a response larger than 5 MiB), and `LOOKUP_FAILED` (still failing after
`lookupMaxAttempts`).

### Suggested HTTP mapping

| Operation | Route | Success | Errors |
|---|---|---|---|
| Submit | `POST /repositories/:repositoryId/scans/:scanId/maintainer-signals` | `202` with `{ jobId, status }` | `400 INVALID_REQUEST`, `413 TOO_MANY_PACKAGES`, `409 CONFLICT`, `503 QUEUE_FULL` (with `Retry-After`), `404 SIGNALS_DISABLED` |
| Job status | `GET /maintainer-signal-jobs/:jobId` | `200` | `404` for unknown or other-tenant jobs |
| Report | `GET /repositories/:repositoryId/scans/:scanId/maintainer-signals` | `200` | `404` until a report exists |

Take `tenantId` from the authenticated principal, never from the request body.

## Configuration

Every option can be passed in code (`config`) or through the environment
(`loadMaintainerSignalConfigFromEnv`). Unset or empty variables keep their
defaults. A value that is set but invalid throws a `RangeError` at startup.

| Option | Env var | Default | Meaning |
|---|---|---|---|
| `enabled` | `MAINTAINER_SIGNALS_ENABLED` | `true` | Master switch. When off, submissions get `SIGNALS_DISABLED`. |
| `supportedEcosystems` | `MAINTAINER_SIGNALS_ECOSYSTEMS` (comma-separated) | `cargo,npm` | Ecosystems to look up. An ecosystem also needs a provider. |
| `minSeverity` | `MAINTAINER_SIGNALS_MIN_SEVERITY` | `low` | `info`, `low`, `medium`, or `high`. |
| `maxPackagesPerScan` | `MAINTAINER_SIGNALS_MAX_PACKAGES` | `2000` | Distinct packages per scan. |
| `maxMaintainersPerPackage` | `MAINTAINER_SIGNALS_MAX_MAINTAINERS` | `200` | Larger registry answers count as `INVALID_METADATA`. |
| `maxReportedSkips` | `MAINTAINER_SIGNALS_MAX_REPORTED_SKIPS` | `100` | Skip details kept per report. Counts are always exact. |
| `lookupConcurrency` | `MAINTAINER_SIGNALS_LOOKUP_CONCURRENCY` | `8` | Registry requests in flight per job. |
| `lookupTimeoutMs` | `MAINTAINER_SIGNALS_LOOKUP_TIMEOUT_MS` | `10000` | Per-lookup timeout. The request is aborted when it expires. |
| `lookupMaxAttempts` | `MAINTAINER_SIGNALS_LOOKUP_MAX_ATTEMPTS` | `3` | Tries per package for transient failures. |
| `lookupRetryBackoffMs` | `MAINTAINER_SIGNALS_LOOKUP_RETRY_BACKOFF_MS` | `250` | First lookup retry delay. It doubles on each further try. |
| `maxFailedLookupRatio` | `MAINTAINER_SIGNALS_MAX_FAILED_LOOKUP_RATIO` | `0.2` | Tolerated share of failed lookups (0–1). |
| `maxAttempts` | `MAINTAINER_SIGNALS_MAX_ATTEMPTS` | `3` | Job attempts before dead-lettering. |
| `retryBackoffMs` / `maxRetryBackoffMs` | `MAINTAINER_SIGNALS_RETRY_BACKOFF_MS` / `_MAX_RETRY_BACKOFF_MS` | `5000` / `300000` | Job retry backoff, exponential and capped. |
| `leaseTtlMs` | `MAINTAINER_SIGNALS_LEASE_TTL_MS` | `300000` | Worker lease. It is renewed after every lookup. |
| `maxPendingJobs` / `maxPendingJobsPerTenant` | `MAINTAINER_SIGNALS_MAX_PENDING_JOBS` / `_PER_TENANT` | `500` / `50` | In-flight caps. Above them, submissions get `QUEUE_FULL`. |
| `finishedJobRetentionMs` | `MAINTAINER_SIGNALS_FINISHED_JOB_RETENTION_MS` | `3600000` | How long finished jobs stay queryable. |

## Error codes

| Code | Retryable | Where | Meaning |
|---|---|---|---|
| `SIGNALS_DISABLED` | no | submit | Feature switched off. |
| `INVALID_REQUEST` | no | submit | Bad ids; both or neither of `packages`/`fromSbom`; `fromSbom` without a configured SBOM source; malformed package entry. |
| `TOO_MANY_PACKAGES` | no | submit, job | More than `maxPackagesPerScan` (checked on the job when the list comes from an SBOM). |
| `CONFLICT` | no | submit | A different package set is already in flight for this scan. |
| `QUEUE_FULL` | yes | submit | Global or tenant cap reached. |
| `SBOM_NOT_FOUND` | yes | job | `fromSbom` and the SBOM has not been ingested (yet). |
| `LOOKUP_FAILURE_THRESHOLD` | yes | job | Failed lookups exceeded `maxFailedLookupRatio`. |
| `STORAGE_FAILURE` | yes | job | Reading or writing baselines, reports, or the SBOM failed. |
| `LEASE_EXPIRED` | yes | job | The worker lost its lease. |

Error messages are fixed strings. They never contain registry data, URLs, or
the underlying cause, which can include proxy credentials.

## Failure semantics

- **Per package.** `UNSUPPORTED_ECOSYSTEM`, `NOT_FOUND`, and `INVALID_METADATA`
  skip the package and do not count as failures. Network errors, timeouts, HTTP
  429, and 5xx responses are retried up to `lookupMaxAttempts` times, then the
  package is skipped as `LOOKUP_FAILED`.
- **Partial results.** If `LOOKUP_FAILED` packages make up at most
  `maxFailedLookupRatio` of the packages actually looked up (unsupported
  ecosystems excluded), the report is stored with `status: "partial"`.
  Baselines of the failed packages are **not** touched, so a change that
  happened while the registry was unreachable is still reported on a later scan.
- **Too many failures.** Above the ratio, the job fails with
  `LOOKUP_FAILURE_THRESHOLD`. Nothing is persisted, and the whole job is retried
  with backoff.
- **Write ordering.** The report is written before the baselines. If the
  baseline write fails, the job is retried. The retry compares against the
  unchanged baselines, computes the same signals, and rewrites the same report,
  so no signal is lost or duplicated.
- **Job retries.** Retryable codes are retried with exponential backoff until
  `maxAttempts`. Anything else, or running out of attempts, dead-letters the job
  and records the last error code on `getJob(...).lastErrorCode`.
- **Lease loss.** Workers hold a fenced lease from `ScanLeaseManager` and renew
  it after each lookup. A worker that loses its lease (because it was paused
  longer than `leaseTtlMs`) stops and persists nothing. Another worker re-runs
  the job.
- **Late writers.** Reports and baselines are written only when the stored
  record's `revision` is not higher than the job's. A slow, older job can never
  roll a baseline back over a newer scan's.

## Tenant isolation

Every read and write takes `tenantId` explicitly. `getJob` hides other
tenants' jobs. The file store puts each tenant in its own directory, named by
the SHA-256 digest of the tenant id. File names are digests too, so crafted ids
cannot escape the store root. On read, the store also checks that a file holds
the record it was asked for.

## Privacy, logs, and metrics

- **Emails are never stored, logged, or reported.** During normalization each
  email is reduced to a SHA-256 digest of its lower-cased domain, which is just
  enough to notice that a domain changed. Reports contain registry handles,
  which registries publish openly.
- **Logs** are one JSON object per line (`component: "maintainer-signals"`)
  and contain only ids, counts, and codes. Events:
  `maintainer_signals.submitted`, `.submission_rejected`, `.analyzed` (with
  package, skip, and failure counts, `signalCount`, `highSeveritySignals`, and
  duration), `.analysis_failed` (with code and retry or dead-letter outcome),
  `.lease_lost`, and `.leases_recovered`. The sanitizer drops any key that
  looks like a payload or credential, as well as keys like `email`, `handle`,
  `login`, `publisher`, `user`, and `maintainer*` (except `maintainerCount`).
  This applies to custom loggers too.
- **Metrics** use only closed label sets: outcome, error code, report status,
  configured ecosystem, skip reason, and signal type. No tenant, repository,
  package, or maintainer value is used as a label.

| Metric | Type | Labels |
|---|---|---|
| `gasguard_maintainer_signal_submissions_total` | counter | `outcome` |
| `gasguard_maintainer_signal_submission_rejections_total` | counter | `code` |
| `gasguard_maintainer_signal_jobs_completed_total` | counter | `status` |
| `gasguard_maintainer_signal_job_failures_total` | counter | `code` |
| `gasguard_maintainer_signal_jobs_dead_lettered_total` | counter | |
| `gasguard_maintainer_signal_stale_completions_total` | counter | |
| `gasguard_maintainer_signal_leases_recovered_total` | counter | |
| `gasguard_maintainer_registry_lookups_total` | counter | `ecosystem`, `outcome` |
| `gasguard_maintainer_registry_lookup_retries_total` | counter | |
| `gasguard_maintainer_packages_skipped_total` | counter | `reason` |
| `gasguard_maintainer_signals_total` | counter | `type` |
| `gasguard_maintainer_signal_queue_jobs` | gauge | `status` |

Useful alerts: a rising `registry_lookups_total{outcome="failed"}` means a
registry is degraded. Any `job_failures_total{code="LOOKUP_FAILURE_THRESHOLD"}`
or `jobs_dead_lettered_total` deserves a look. Any
`signals_total{type="OWNERSHIP_TRANSFERRED"}` should be triaged.

## Backward compatibility

- This is a new, opt-in module. No existing API, analyzer, or SBOM behaviour
  changes. The SBOM module is only read, through the `sbomSource` callback and
  the `NormalizedSbom` type.
- Existing repositories start with no baselines, so the first scan after
  rollout produces no signals.
- `report.schemaVersion` is `1`. Adding fields or signal types is
  non-breaking, so consumers should ignore unknown `type` values. Removing or
  renaming fields will bump the schema version.
- Stored baselines carry no schema-dependent data other than handles and
  domain digests, so changing a default severity needs no migration.

## Verification

```bash
cd apps/api
npx jest src/maintainer-signals                    # all suites

npx jest src/maintainer-signals/maintainer-signal-analyzer.spec.ts         # normalization + change detection
npx jest src/maintainer-signals/maintainer-registry-provider.spec.ts       # npm / crates.io over recorded responses
npx jest src/maintainer-signals/maintainer-signal-store.spec.ts            # in-memory + file store, isolation, revisions
npx jest src/maintainer-signals/maintainer-signal-config.spec.ts           # config + env validation
npx jest src/maintainer-signals/maintainer-signal.integration.spec.ts      # service ↔ queue ↔ providers ↔ SBOM ↔ stores
```

The integration suite runs a representative repository end to end. It ingests
the CycloneDX fixture `apps/api/src/sbom/__fixtures__/cyclonedx-1.5.json`
(npm `lodash`, scoped `@openzeppelin/contracts`, and cargo `soroban-sdk`)
through the real `SbomIngestionService`, then resolves maintainers through the
real npm and crates.io providers. The providers are fed recorded registry
responses (`apps/api/src/maintainer-signals/__fixtures__/`, with addresses
replaced by `example` domains), so the tests need no network access. The
suite then rescans with a changed lodash manifest and asserts the exact
signals.
