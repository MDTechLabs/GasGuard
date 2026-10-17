# SBOM Ingestion for Repository Scans

Part of the **Supply Chain** workstream.

[`SBOM.md`](./SBOM.md) covers the SBOMs GasGuard *publishes* for its own
releases. This document covers the other direction: accepting an SBOM that a
scanned repository *supplies*, normalizing it, and attaching it to that scan so
analyzers and reports can reason about the repository's dependencies.

Code: [`apps/api/src/sbom/`](../apps/api/src/sbom).

## Supported input

| Format | Versions | Notes |
|---|---|---|
| CycloneDX JSON | 1.4, 1.5, 1.6 | Nested `components` are flattened depth-first. `metadata.component` (the repository itself) is excluded. |
| SPDX JSON | SPDX-2.2, SPDX-2.3 | Each `packages[]` entry is a component. Packages named by `documentDescribes` or a `SPDXRef-DOCUMENT DESCRIBES` relationship (the repository itself) are excluded. |

Not supported, rejected with `UNSUPPORTED_FORMAT`: CycloneDX XML, SPDX
tag-value, SPDX RDF/YAML, and any other JSON. Spec versions outside the table are
rejected with `UNSUPPORTED_VERSION` rather than parsed on a best-effort basis, so
a new spec version can never be silently misread.

## Normalized output

Every accepted document becomes a `NormalizedSbom`:

```ts
{
  format: "cyclonedx" | "spdx",
  specVersion: "1.5",
  contentHash: "<sha256 of the uploaded bytes>",
  components: [
    {
      name: "lodash",
      version: "4.17.21",            // omitted when absent or NOASSERTION
      group: "@scope",               // CycloneDX only, when present
      purl: "pkg:npm/lodash@4.17.21",
      ecosystem: "npm",              // purl type
      licenses: ["MIT"],             // sorted, unique; NOASSERTION/NONE dropped
      hashes: [{ algorithm: "SHA-256", value: "…" }],
    },
  ],
  stats: { total, accepted, rejected, duplicates },
  rejected: [{ index, reason }],     // first maxReportedRejections only
  summary: {                         // for scan reports
    totalComponents, byEcosystem, componentsWithoutVersion,
    componentsWithoutLicense, distinctLicenses,
  },
}
```

Output is **deterministic**: components are de-duplicated by purl (or
`group/name@version` without one) and sorted by that identity using
locale-independent ordering. The same bytes always produce the same result.

Credentials embedded in URLs inside purls (for example a percent-encoded
`repository_url=https://user:token@host` qualifier) are stripped before storage.
Hashes with unknown algorithms or non-hex values are dropped without rejecting
the component.

## Public interface

```ts
import {
  SbomIngestionService,
  SbomIngestionWorker,
  FileSbomStore,
  loadSbomIngestionConfigFromEnv,
} from "apps/api/src/sbom";

const service = new SbomIngestionService({
  store: new FileSbomStore("/var/lib/gasguard/sbom"),
  config: loadSbomIngestionConfigFromEnv(),
});

// API boundary: cheap validation only, returns immediately.
const { jobId, status } = await service.submit({
  tenantId, repositoryId, scanId,
  document: rawRequestBody,          // string or Buffer
});

// Worker boundary.
const worker = new SbomIngestionWorker(service, { workerId: "api-1" });
worker.start();
gracefulShutdown.registerShutdownHook(() => worker.stop());

// Status and reporting boundary (tenant-scoped).
service.getJob(tenantId, jobId);                     // status, attempts, lastErrorCode
await service.getResult(tenantId, repositoryId, scanId); // StoredSbom | undefined
service.metricsText();                               // Prometheus exposition
```

| Member | Purpose |
|---|---|
| `submit(request)` | Validates identifiers and size, de-duplicates, enqueues. Throws `SbomIngestionError`. |
| `processNext(workerId)` | Claims and runs one due job. Never throws for job failures; returns `idle`, `completed`, `retry_scheduled`, `dead_lettered`, or `stale`. |
| `drain(workerId, maxJobs?)` | Runs `processNext` until idle. Useful for tests and one-shot CLI runs. |
| `getJob(tenantId, jobId)` | Job state, or `undefined` if the job belongs to another tenant. |
| `getResult(tenantId, repositoryId, scanId)` | The stored, normalized SBOM. |
| `queueStats()` / `metricsText()` | Queue depth and metrics. |
| `SbomStore` | Persistence interface. `InMemorySbomStore` (tests, single process) and `FileSbomStore` (durable, atomic writes) are provided. |
| `parseSbom(input, limits)` | Pure parser, usable on its own by analyzers or the CLI. |

Identifiers (`tenantId`, `repositoryId`, `scanId`) must be 1–256 characters of
letters, digits, and `._:/@-`, starting with a letter or digit.

### Suggested HTTP mapping

The module stays independent of NestJS. A controller mounting it should map
errors as follows:

| Code | HTTP | Retryable | Raised by |
|---|---|---|---|
| `INVALID_REQUEST` | 400 | no | `submit` |
| `INGESTION_DISABLED` | 403 | no | `submit` |
| `CONFLICT` | 409 | no | `submit` |
| `DOCUMENT_TOO_LARGE` | 413 | no | `submit`, worker |
| `QUEUE_FULL` | 429 + `Retry-After` | **yes** | `submit` |
| `UNSUPPORTED_FORMAT` | job state | no | worker |
| `UNSUPPORTED_VERSION` | job state | no | worker |
| `INVALID_DOCUMENT` | job state | no | worker |
| `TOO_MANY_COMPONENTS` | job state | no | worker |
| `TOO_MANY_INVALID_COMPONENTS` | job state | no | worker |
| `STORAGE_FAILURE` | job state | **yes** | worker |
| `LEASE_EXPIRED` | job state | **yes** | worker |

`submit` returns `202 Accepted` with the `jobId`. Format and content errors are
only known once a worker has run; clients poll `getJob` and read
`status` / `lastErrorCode`. Error messages are fixed strings that never echo
document content, so they are safe to return to clients.

## Configuration

| Option | Env var | Default | Meaning |
|---|---|---|---|
| `enabled` | `SBOM_INGESTION_ENABLED` | `true` | Master switch. `false` refuses submissions with `INGESTION_DISABLED`. |
| `maxDocumentBytes` | `SBOM_MAX_DOCUMENT_BYTES` | `10485760` (10 MiB) | Largest document, in UTF-8 bytes. Checked before parsing. |
| `maxComponents` | `SBOM_MAX_COMPONENTS` | `50000` | Most component entries, nested and rejected ones included. Parsing stops as soon as it is exceeded. |
| `maxNestingDepth` | `SBOM_MAX_NESTING_DEPTH` | `16` | Deepest CycloneDX nesting; deeper entries are rejected. |
| `maxRejectedRatio` | `SBOM_MAX_REJECTED_RATIO` | `0.1` | Fraction (0–1) of invalid components tolerated. `0` = strict. |
| `maxReportedRejections` | `SBOM_MAX_REPORTED_REJECTIONS` | `100` | Rejection details kept per document; counts are always exact. |
| `maxAttempts` | `SBOM_MAX_ATTEMPTS` | `3` | Claims per job, the first included, before dead-lettering. |
| `retryBackoffMs` | `SBOM_RETRY_BACKOFF_MS` | `1000` | First retry delay; doubles per attempt. |
| `maxRetryBackoffMs` | `SBOM_MAX_RETRY_BACKOFF_MS` | `60000` | Retry delay cap. |
| `leaseTtlMs` | `SBOM_LEASE_TTL_MS` | `60000` | Time a worker may hold a job before it can be taken over. |
| `maxPendingJobs` | `SBOM_MAX_PENDING_JOBS` | `1000` | In-flight jobs, all tenants. |
| `maxPendingJobsPerTenant` | `SBOM_MAX_PENDING_JOBS_PER_TENANT` | `100` | In-flight jobs for one tenant, so one tenant cannot starve others. |
| `finishedJobRetentionMs` | `SBOM_FINISHED_JOB_RETENTION_MS` | `3600000` | How long finished job records stay queryable. Stored results are unaffected. |

Configuration is validated at startup. Unparseable or out-of-range values throw
a `RangeError` naming the option or variable, so a typo cannot fall back to a
default silently.

## Job lifecycle and failure semantics

```
submit ──► pending ──claim──► running ──complete──► completed
              ▲                  │
              │   retryable      │  lease expired, or
              └──── failure ─────┤  STORAGE_FAILURE, with attempts left
                  (backoff)      │
                                 └── non-retryable, or out of attempts ──► dead_lettered
```

- **Unsupported or invalid input** dead-letters on the first attempt. Retrying
  the same bytes would fail the same way.
- **Partial failure.** Individually invalid components (missing name, malformed
  purl, overlong fields, control characters, excessive nesting) are skipped and
  listed in `rejected`. The document is still accepted while
  `rejected / total <= maxRejectedRatio`. Above that it fails with
  `TOO_MANY_INVALID_COMPONENTS`.
- **Retries.** `STORAGE_FAILURE` and `LEASE_EXPIRED` are retried with
  exponential backoff (`retryBackoffMs * 2^(attempt-1)`, capped). An attempt is
  counted when the job is *claimed*, so a document that crashes its worker every
  time still dead-letters after `maxAttempts` instead of looping forever.
- **De-duplication.** Resubmitting identical bytes for a scan that is in flight
  or completed returns the existing job (`status: "duplicate"`). Different bytes
  while a job for that scan is in flight → `CONFLICT`. After the job finishes,
  new bytes are accepted and replace the stored result.

## Concurrency guarantees

- **Single owner.** Workers claim jobs through the existing `ScanLeaseManager`
  (`apps/api/src/queue/scan-lease.ts`). A running job cannot be claimed by another worker
  until its lease expires.
- **Fencing.** Every claim gets a fencing token that increases on each new grant.
  `complete`, `fail`, and `renew` need the current token. A worker that stalled
  past its lease gets a `stale` outcome and its completion is discarded.
- **Fenced persistence.** Each submission gets a monotonically increasing
  `revision`. Stores only replace a record with one of equal or higher revision,
  so a stalled worker that finishes late cannot overwrite a newer submission's
  result. Equal revisions are accepted because parsing is deterministic: a
  retried job writes the same content.
- **Tenant isolation.** Queue keys, store keys, job lookups, and result lookups
  all include the tenant id. `FileSbomStore` derives paths from SHA-256 digests
  of the ids, so crafted ids cannot escape the root directory, and it checks that
  a file's contents match the key it was read for.

### Deployment scope

The job queue and its leases live in process memory, as `ScanLeaseManager`
does. Run one ingestion queue per API process. Jobs that are in flight when a
process dies are lost, but nothing is half-written: the client sees the job
disappear and resubmits, and de-duplication makes that safe. `FileSbomStore`
serializes conditional writes within one process. Several processes sharing
storage need a database-backed `SbomStore` that does the revision check as one
conditional update (for example `UPDATE … WHERE revision <= $1`).

## Resource bounds

- Size is checked in UTF-8 bytes **before** hashing or parsing.
- Component traversal is iterative, so deep nesting cannot exhaust the stack,
  and it stops at `maxComponents`.
- At most `maxPendingJobs` payloads are held in memory. A payload is dropped as
  soon as its job finishes, and finished job records are pruned after
  `finishedJobRetentionMs`.
- Memory held by queued payloads is therefore bounded by roughly
  `maxPendingJobs × maxDocumentBytes`. Lower either one on small instances.

## Observability

### Logs

Logs are structured, one JSON object per line, with `component:
"sbom-ingestion"`. Every field passes through `sanitizeLogFields`, which keeps
only primitives, truncates strings to 200 characters, and drops keys that look
like payloads or credentials (`payload`, `document`, `body`, `secret`, `token`,
`password`, `key`, `credential`, `authorization`). The service applies this to
custom loggers too.

| Event | Level | Fields |
|---|---|---|
| `sbom.submitted` | info | tenantId, repositoryId, scanId, jobId, outcome, bytes, contentHash (12-char prefix) |
| `sbom.submission_rejected` | warn | tenantId/repositoryId/scanId (only when well-formed), code |
| `sbom.ingested` | info | ids, workerId, attempt, format, specVersion, components, rejectedComponents, duplicateComponents, contentHash, superseded, durationMs |
| `sbom.ingest_failed` | warn (retry) / error (dead-letter) | ids, workerId, attempt, maxAttempts, code, outcome |
| `sbom.lease_lost` | warn | tenantId, scanId, jobId, workerId, attempt |
| `sbom.leases_recovered` | warn | count |

Document contents, component data, and raw exception messages are never logged.
Exception messages from `JSON.parse` or the filesystem can quote input or paths,
so they are replaced with error codes.

### Metrics

`service.metricsText()` returns Prometheus text. Labels come from closed sets
(outcome, error code, job status) only, never tenant or document data.

| Metric | Type | Labels |
|---|---|---|
| `gasguard_sbom_submissions_total` | counter | `outcome` = accepted / duplicate / rejected |
| `gasguard_sbom_submission_rejections_total` | counter | `code` |
| `gasguard_sbom_jobs_completed_total` | counter | — |
| `gasguard_sbom_job_failures_total` | counter | `code` |
| `gasguard_sbom_jobs_dead_lettered_total` | counter | — |
| `gasguard_sbom_stale_completions_total` | counter | — |
| `gasguard_sbom_leases_recovered_total` | counter | — |
| `gasguard_sbom_components_ingested_total` | counter | — |
| `gasguard_sbom_components_rejected_total` | counter | — |
| `gasguard_sbom_queue_jobs` | gauge | `status` |

Suggested alerts:
- Sustained growth in `job_failures_total{code="STORAGE_FAILURE"}` means the store is unhealthy.
- A rising `leases_recovered_total` means workers are dying or `leaseTtlMs` is too short.
- `submission_rejections_total{code="QUEUE_FULL"}` means more workers or capacity are needed.

## Backward compatibility

- The feature is additive. Scans without an SBOM behave exactly as before, and
  no existing module, route, or queue is changed.
- `SBOM_INGESTION_ENABLED=false` turns it off without a deploy.
- `NormalizedSbom` and `StoredSbom` change only by adding fields. Consumers should
  ignore fields they do not recognise.
- New CycloneDX or SPDX versions are added to `SUPPORTED_CYCLONEDX_VERSIONS` /
  `SUPPORTED_SPDX_VERSIONS` explicitly, each with fixtures. Until then they are
  rejected with `UNSUPPORTED_VERSION`.

## Verification

```bash
# All SBOM ingestion tests: unit, integration, load, and fault
npx jest apps/api/src/sbom

# Single suites
npx jest apps/api/src/sbom/sbom-parser.spec.ts                # parser: success, boundary, invalid input
npx jest apps/api/src/sbom/sbom-job-queue.spec.ts             # claims, fencing, retries, retention
npx jest apps/api/src/sbom/sbom-store.spec.ts                 # in-memory + file store, isolation, atomicity
npx jest apps/api/src/sbom/sbom-ingestion.integration.spec.ts # service ↔ queue ↔ parser ↔ durable store
npx jest apps/api/src/sbom/sbom-ingestion.load.spec.ts        # 400-job load, seeded chaos, memory bounds
```

The fault tests use a seeded PRNG (`mulberry32`, seeds 1–3), so every injected
storage failure and worker crash is reproducible.

## Related

[Package maintainer change signals](./MAINTAINER_CHANGE_SIGNALS.md) can take a
scan's package list from its ingested SBOM (`fromSbom: true`).
