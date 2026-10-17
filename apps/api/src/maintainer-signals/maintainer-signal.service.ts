/**
 * Package maintainer change signals for repository scans.
 *
 * The API layer calls `submit` with a scan's package list (or asks for it to be
 * taken from the scan's ingested SBOM); workers call `processNext` to look up
 * current maintainers, compare them with the repository's baselines, and
 * persist a report; the reporting layer reads it with `getReport`. Every
 * boundary is tenant-scoped.
 *
 * Failure semantics:
 * - Unsupported ecosystems, unknown packages, and malformed registry data skip
 *   the package (listed in `report.skipped`) without failing the job.
 * - Transient lookup failures are retried per package. Packages still failing
 *   afterwards are skipped as LOOKUP_FAILED and the report is `partial`, as
 *   long as they stay within `maxFailedLookupRatio`; beyond it the job fails
 *   with LOOKUP_FAILURE_THRESHOLD and is retried as a whole.
 * - Baselines of skipped packages are left untouched, so a change that happens
 *   while a registry is unreachable is still reported on a later scan.
 * - The report is written before baselines. If the baseline write fails the
 *   job is retried, recomputes the same signals against the unchanged
 *   baselines, and rewrites the same report, so no signal is lost.
 */

import type { NormalizedSbom } from "../sbom/sbom-types";
import {
  DEFAULT_MAINTAINER_SIGNAL_CONFIG,
  MaintainerSignalConfig,
  resolveMaintainerSignalConfig,
} from "./maintainer-signal-config";
import {
  InvalidMaintainerMetadataError,
  MaintainerBaseline,
  compareSignals,
  comparePackages,
  detectMaintainerChanges,
  maintainersChanged,
  normalizeMaintainerSnapshot,
  normalizePackageRefs,
  packageKey,
  packagesFromSbom,
} from "./maintainer-signal-analyzer";
import {
  MaintainerSignalLogger,
  MaintainerSignalMetrics,
  consoleMaintainerSignalLogger,
  sanitizeMaintainerLogFields,
} from "./maintainer-signal-metrics";
import {
  MaintainerSignalJob,
  MaintainerSignalJobInput,
  MaintainerSignalJobQueue,
} from "./maintainer-signal-queue";
import {
  MaintainerRegistryProvider,
  RegistryLookupError,
  defaultMaintainerProviders,
} from "./maintainer-registry-provider";
import type { MaintainerSignalStore } from "./maintainer-signal-store";
import {
  MaintainerSignal,
  MaintainerSignalError,
  MaintainerSignalErrorCode,
  MaintainerSignalReport,
  MaintainerSignalType,
  PackageMaintainerSnapshot,
  PackageRef,
  PackageSkipReason,
  SEVERITY_RANK,
  SkippedPackage,
} from "./maintainer-signal-types";

export interface MaintainerSignalSubmitRequest {
  tenantId: string;
  repositoryId: string;
  scanId: string;
  /** Packages to analyze. Mutually exclusive with `fromSbom`. */
  packages?: PackageRef[];
  /** Take packages from the scan's ingested SBOM (requires `sbomSource`). */
  fromSbom?: boolean;
}

export interface MaintainerSignalSubmitResult {
  status: "accepted" | "duplicate";
  jobId: string;
  jobStatus: MaintainerSignalJob["status"];
}

export type MaintainerSignalProcessOutcome =
  | { status: "idle" }
  | {
      status: "completed";
      jobId: string;
      reportStatus: MaintainerSignalReport["status"];
      signals: number;
      superseded: boolean;
    }
  | {
      status: "retry_scheduled";
      jobId: string;
      code: MaintainerSignalErrorCode;
    }
  | { status: "dead_lettered"; jobId: string; code: MaintainerSignalErrorCode }
  | { status: "stale"; jobId: string };

/** Reads a scan's ingested SBOM, e.g. `SbomIngestionService.getResult`. */
export type SbomSource = (
  tenantId: string,
  repositoryId: string,
  scanId: string,
) => Promise<NormalizedSbom | undefined>;

export interface MaintainerSignalServiceOptions {
  store: MaintainerSignalStore;
  /** Defaults to the bundled npm and crates.io providers. */
  providers?: MaintainerRegistryProvider[];
  sbomSource?: SbomSource;
  config?: Partial<MaintainerSignalConfig>;
  logger?: MaintainerSignalLogger;
  metrics?: MaintainerSignalMetrics;
  clock?: () => number;
  /** Used for lookup retry backoff; injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/;

type LookupResult =
  | { kind: "found"; ref: PackageRef; snapshot: PackageMaintainerSnapshot }
  | { kind: "skipped"; ref: PackageRef; reason: PackageSkipReason };

class LeaseLostError extends Error {}

export class MaintainerSignalService {
  readonly config: MaintainerSignalConfig;
  readonly metrics: MaintainerSignalMetrics;
  private readonly store: MaintainerSignalStore;
  private readonly providers: Map<string, MaintainerRegistryProvider>;
  private readonly sbomSource?: SbomSource;
  private readonly queue: MaintainerSignalJobQueue;
  private readonly logger: MaintainerSignalLogger;
  private readonly clock: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: MaintainerSignalServiceOptions) {
    this.config = resolveMaintainerSignalConfig(
      options.config ?? DEFAULT_MAINTAINER_SIGNAL_CONFIG,
    );
    this.store = options.store;
    this.providers = new Map(
      (options.providers ?? defaultMaintainerProviders()).map((p) => [
        p.ecosystem,
        p,
      ]),
    );
    this.sbomSource = options.sbomSource;
    const logger = options.logger ?? consoleMaintainerSignalLogger;
    // Sanitize here too, so a custom logger never receives more than ids,
    // counts, and codes.
    this.logger = {
      log: (level, event, fields) =>
        logger.log(level, event, sanitizeMaintainerLogFields(fields)),
    };
    this.metrics = options.metrics ?? new MaintainerSignalMetrics();
    this.clock = options.clock ?? Date.now;
    this.sleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.queue = new MaintainerSignalJobQueue(this.config, this.clock);
  }

  /**
   * Queue a scan for maintainer analysis.
   *
   * @throws MaintainerSignalError SIGNALS_DISABLED, INVALID_REQUEST,
   *   TOO_MANY_PACKAGES, CONFLICT, or QUEUE_FULL (retryable).
   */
  async submit(
    request: MaintainerSignalSubmitRequest,
  ): Promise<MaintainerSignalSubmitResult> {
    try {
      if (!this.config.enabled) {
        throw new MaintainerSignalError(
          "SIGNALS_DISABLED",
          "Maintainer change signals are disabled",
        );
      }
      requireIdentifier(request?.tenantId, "tenantId");
      requireIdentifier(request.repositoryId, "repositoryId");
      requireIdentifier(request.scanId, "scanId");
      const input = this.resolveInput(request);
      const result = this.queue.enqueue({
        tenantId: request.tenantId,
        repositoryId: request.repositoryId,
        scanId: request.scanId,
        input,
      });
      const status = result.status === "enqueued" ? "accepted" : "duplicate";
      this.metrics.recordSubmission(status);
      this.logger.log("info", "maintainer_signals.submitted", {
        tenantId: request.tenantId,
        repositoryId: request.repositoryId,
        scanId: request.scanId,
        jobId: result.job.jobId,
        outcome: status,
        source: input.source,
        packageCount:
          input.source === "packages" ? input.packages.length : undefined,
      });
      return { status, jobId: result.job.jobId, jobStatus: result.job.status };
    } catch (error) {
      const code =
        error instanceof MaintainerSignalError ? error.code : "INVALID_REQUEST";
      this.metrics.recordSubmission("rejected", code);
      this.logger.log("warn", "maintainer_signals.submission_rejected", {
        tenantId: safeIdentifier(request?.tenantId),
        repositoryId: safeIdentifier(request?.repositoryId),
        scanId: safeIdentifier(request?.scanId),
        code,
      });
      throw error;
    }
  }

  /**
   * Claim and run the next due job as `workerId`. Never throws for job-level
   * failures; the outcome says what happened.
   */
  async processNext(workerId: string): Promise<MaintainerSignalProcessOutcome> {
    const recovered = this.queue.recoverExpired();
    if (recovered.length > 0) {
      this.metrics.recordLeasesRecovered(recovered.length);
      this.logger.log("warn", "maintainer_signals.leases_recovered", {
        count: recovered.length,
      });
    }
    const claim = this.queue.claim(workerId);
    if (!claim) {
      return { status: "idle" };
    }
    const { job, token, input } = claim;
    const startedAt = this.clock();
    const renew = () => {
      if (!this.queue.renew(job.jobId, workerId, token)) {
        throw new LeaseLostError();
      }
    };

    let report: MaintainerSignalReport;
    let baselines: MaintainerBaseline[];
    let skipCounts: Partial<Record<PackageSkipReason, number>>;
    try {
      ({ report, baselines, skipCounts } = await this.analyze(
        job,
        input,
        renew,
      ));
    } catch (error) {
      if (error instanceof LeaseLostError) {
        return this.staleJob(job, workerId);
      }
      const code =
        error instanceof MaintainerSignalError ? error.code : "STORAGE_FAILURE";
      return this.failJob(job, workerId, token, code, startedAt);
    }

    if (!this.queue.isCurrent(job.jobId, workerId, token)) {
      return this.staleJob(job, workerId);
    }
    let superseded: boolean;
    try {
      superseded = (await this.store.putReport(report)) === "stale";
      if (!superseded) {
        await this.store.putBaselines(
          job.tenantId,
          job.repositoryId,
          baselines,
        );
      }
    } catch {
      return this.failJob(job, workerId, token, "STORAGE_FAILURE", startedAt);
    }
    if (!this.queue.complete(job.jobId, workerId, token)) {
      return this.staleJob(job, workerId);
    }

    const durationMs = this.clock() - startedAt;
    const signalCounts: Partial<Record<MaintainerSignalType, number>> = {};
    for (const s of report.signals) {
      signalCounts[s.type] = (signalCounts[s.type] ?? 0) + 1;
    }
    this.metrics.recordCompleted(
      report.status,
      durationMs,
      signalCounts,
      skipCounts,
    );
    this.logger.log("info", "maintainer_signals.analyzed", {
      tenantId: job.tenantId,
      repositoryId: job.repositoryId,
      scanId: job.scanId,
      jobId: job.jobId,
      workerId,
      attempt: job.attempts,
      reportStatus: report.status,
      packageCount: report.stats.packages,
      compared: report.stats.compared,
      baselined: report.stats.baselined,
      changed: report.stats.changed,
      skipped: report.stats.skipped,
      lookupFailures: report.stats.lookupFailures,
      signalCount: report.signals.length,
      highSeveritySignals: report.signals.filter((s) => s.severity === "high")
        .length,
      superseded,
      durationMs,
    });
    return {
      status: "completed",
      jobId: job.jobId,
      reportStatus: report.status,
      signals: report.signals.length,
      superseded,
    };
  }

  async drain(
    workerId: string,
    maxJobs = Number.POSITIVE_INFINITY,
  ): Promise<MaintainerSignalProcessOutcome[]> {
    const outcomes: MaintainerSignalProcessOutcome[] = [];
    while (outcomes.length < maxJobs) {
      const outcome = await this.processNext(workerId);
      if (outcome.status === "idle") {
        break;
      }
      outcomes.push(outcome);
    }
    return outcomes;
  }

  /** The job, if it exists and belongs to `tenantId`. */
  getJob(tenantId: string, jobId: string): MaintainerSignalJob | undefined {
    const job = this.queue.get(jobId);
    return job && job.tenantId === tenantId ? job : undefined;
  }

  getReport(
    tenantId: string,
    repositoryId: string,
    scanId: string,
  ): Promise<MaintainerSignalReport | undefined> {
    return this.store.getReport(tenantId, repositoryId, scanId);
  }

  queueStats() {
    return this.queue.stats();
  }

  metricsText(): string {
    return this.metrics.toPrometheus(this.queue.stats());
  }

  private resolveInput(
    request: MaintainerSignalSubmitRequest,
  ): MaintainerSignalJobInput {
    const hasPackages = request.packages !== undefined;
    if (hasPackages === Boolean(request.fromSbom)) {
      throw new MaintainerSignalError(
        "INVALID_REQUEST",
        "Provide exactly one of packages or fromSbom",
      );
    }
    if (request.fromSbom) {
      if (!this.sbomSource) {
        throw new MaintainerSignalError(
          "INVALID_REQUEST",
          "fromSbom is not available: no SBOM source is configured",
        );
      }
      return { source: "sbom" };
    }
    const packages = normalizePackageRefs(request.packages);
    this.requirePackageLimit(packages.length);
    return { source: "packages", packages };
  }

  private requirePackageLimit(count: number): void {
    if (count > this.config.maxPackagesPerScan) {
      throw new MaintainerSignalError(
        "TOO_MANY_PACKAGES",
        `Scan has more than ${this.config.maxPackagesPerScan} packages`,
      );
    }
  }

  private async analyze(
    job: MaintainerSignalJob,
    input: MaintainerSignalJobInput,
    renew: () => void,
  ): Promise<{
    report: MaintainerSignalReport;
    baselines: MaintainerBaseline[];
    skipCounts: Partial<Record<PackageSkipReason, number>>;
  }> {
    const packages = await this.loadPackages(job, input);
    const results = await this.lookupAll(packages, renew);

    const skipped = results.filter(
      (r): r is Extract<LookupResult, { kind: "skipped" }> =>
        r.kind === "skipped",
    );
    const found = results.filter(
      (r): r is Extract<LookupResult, { kind: "found" }> => r.kind === "found",
    );
    const lookupFailures = skipped.filter(
      (r) => r.reason === "LOOKUP_FAILED",
    ).length;
    const attempted = results.filter(
      (r) => r.kind === "found" || r.reason !== "UNSUPPORTED_ECOSYSTEM",
    ).length;
    if (
      lookupFailures > 0 &&
      lookupFailures / attempted > this.config.maxFailedLookupRatio
    ) {
      throw new MaintainerSignalError(
        "LOOKUP_FAILURE_THRESHOLD",
        "Too many registry lookups failed",
      );
    }

    let existing: MaintainerBaseline[];
    try {
      existing = await this.store.getBaselines(
        job.tenantId,
        job.repositoryId,
        found.map((r) => ({ ecosystem: r.ref.ecosystem, package: r.ref.name })),
      );
    } catch {
      throw new MaintainerSignalError(
        "STORAGE_FAILURE",
        "Failed to read maintainer baselines",
      );
    }
    const baselineByKey = new Map(
      existing.map((b) => [packageKey(b.ecosystem, b.package), b]),
    );

    const now = this.clock();
    const minRank = SEVERITY_RANK[this.config.minSeverity];
    const signals: MaintainerSignal[] = [];
    const baselines: MaintainerBaseline[] = [];
    let compared = 0;
    let changed = 0;
    for (const { ref, snapshot } of found) {
      const baseline = baselineByKey.get(packageKey(ref.ecosystem, ref.name));
      if (baseline) {
        compared++;
        if (maintainersChanged(baseline, snapshot)) {
          changed++;
        }
      }
      for (const signal of detectMaintainerChanges(ref, baseline, snapshot)) {
        if (SEVERITY_RANK[signal.severity] >= minRank) {
          signals.push(signal);
        }
      }
      baselines.push({
        ecosystem: ref.ecosystem,
        package: ref.name,
        maintainers: snapshot.maintainers,
        observedAt: now,
        revision: job.revision,
      });
    }
    signals.sort(compareSignals);

    const skipList: SkippedPackage[] = skipped
      .map((r) => ({
        ecosystem: r.ref.ecosystem,
        package: r.ref.name,
        reason: r.reason,
      }))
      .sort(comparePackages);
    const skipCounts: Partial<Record<PackageSkipReason, number>> = {};
    for (const s of skipList) {
      skipCounts[s.reason] = (skipCounts[s.reason] ?? 0) + 1;
    }

    return {
      baselines,
      skipCounts,
      report: {
        schemaVersion: 1,
        tenantId: job.tenantId,
        repositoryId: job.repositoryId,
        scanId: job.scanId,
        jobId: job.jobId,
        revision: job.revision,
        analyzedAt: now,
        status: lookupFailures > 0 ? "partial" : "complete",
        signals,
        skipped: skipList.slice(0, this.config.maxReportedSkips),
        stats: {
          packages: packages.length,
          compared,
          baselined: found.length - compared,
          changed,
          skipped: skipList.length,
          lookupFailures,
        },
      },
    };
  }

  private async loadPackages(
    job: MaintainerSignalJob,
    input: MaintainerSignalJobInput,
  ): Promise<PackageRef[]> {
    if (input.source === "packages") {
      return input.packages;
    }
    let sbom: NormalizedSbom | undefined;
    try {
      sbom = await (this.sbomSource as SbomSource)(
        job.tenantId,
        job.repositoryId,
        job.scanId,
      );
    } catch {
      throw new MaintainerSignalError(
        "STORAGE_FAILURE",
        "Failed to read the scan's SBOM",
      );
    }
    if (!sbom) {
      // Retryable: the SBOM may still be ingesting.
      throw new MaintainerSignalError(
        "SBOM_NOT_FOUND",
        "The scan has no ingested SBOM",
      );
    }
    const packages = packagesFromSbom(sbom);
    this.requirePackageLimit(packages.length);
    return packages;
  }

  /** Look up every package with bounded concurrency; results keep input order. */
  private async lookupAll(
    packages: PackageRef[],
    renew: () => void,
  ): Promise<LookupResult[]> {
    const results: LookupResult[] = new Array(packages.length);
    let next = 0;
    const workers = Array.from(
      { length: Math.min(this.config.lookupConcurrency, packages.length) },
      async () => {
        while (next < packages.length) {
          const index = next++;
          results[index] = await this.lookup(packages[index]);
          renew();
        }
      },
    );
    await Promise.all(workers);
    return results;
  }

  private async lookup(ref: PackageRef): Promise<LookupResult> {
    const provider = this.providers.get(ref.ecosystem);
    if (!provider || !this.config.supportedEcosystems.includes(ref.ecosystem)) {
      return { kind: "skipped", ref, reason: "UNSUPPORTED_ECOSYSTEM" };
    }
    for (let attempt = 1; ; attempt++) {
      try {
        const raw = await this.withTimeout((signal) =>
          provider.fetchMaintainers(ref, signal),
        );
        if (raw === undefined) {
          this.metrics.recordLookup(ref.ecosystem, "not_found");
          return { kind: "skipped", ref, reason: "NOT_FOUND" };
        }
        const snapshot = normalizeMaintainerSnapshot(
          raw,
          this.config.maxMaintainersPerPackage,
        );
        this.metrics.recordLookup(ref.ecosystem, "found");
        return { kind: "found", ref, snapshot };
      } catch (error) {
        const transient =
          !(error instanceof InvalidMaintainerMetadataError) &&
          !(error instanceof RegistryLookupError && !error.transient);
        if (!transient) {
          this.metrics.recordLookup(ref.ecosystem, "invalid");
          return { kind: "skipped", ref, reason: "INVALID_METADATA" };
        }
        if (attempt >= this.config.lookupMaxAttempts) {
          this.metrics.recordLookup(ref.ecosystem, "failed");
          return { kind: "skipped", ref, reason: "LOOKUP_FAILED" };
        }
        this.metrics.recordLookupRetry();
        await this.sleep(this.config.lookupRetryBackoffMs * 2 ** (attempt - 1));
      }
    }
  }

  /** Run `task` with an aborting signal; reject if it outlives the timeout. */
  private withTimeout<T>(
    task: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new RegistryLookupError("Registry lookup timed out", true));
      }, this.config.lookupTimeoutMs);
    });
    return Promise.race([task(controller.signal), timeout]).finally(() =>
      clearTimeout(timer),
    );
  }

  private failJob(
    job: MaintainerSignalJob,
    workerId: string,
    token: number,
    code: MaintainerSignalErrorCode,
    startedAt: number,
  ): MaintainerSignalProcessOutcome {
    const outcome = this.queue.fail(job.jobId, workerId, token, code);
    if (outcome === "stale") {
      return this.staleJob(job, workerId);
    }
    this.metrics.recordFailure(code, outcome, this.clock() - startedAt);
    this.logger.log(
      outcome === "dead_lettered" ? "error" : "warn",
      "maintainer_signals.analysis_failed",
      {
        tenantId: job.tenantId,
        repositoryId: job.repositoryId,
        scanId: job.scanId,
        jobId: job.jobId,
        workerId,
        attempt: job.attempts,
        maxAttempts: this.config.maxAttempts,
        code,
        outcome,
      },
    );
    return { status: outcome, jobId: job.jobId, code };
  }

  private staleJob(
    job: MaintainerSignalJob,
    workerId: string,
  ): MaintainerSignalProcessOutcome {
    this.metrics.recordStale();
    this.logger.log("warn", "maintainer_signals.lease_lost", {
      tenantId: job.tenantId,
      scanId: job.scanId,
      jobId: job.jobId,
      workerId,
      attempt: job.attempts,
    });
    return { status: "stale", jobId: job.jobId };
  }
}

function requireIdentifier(value: unknown, field: string): void {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new MaintainerSignalError(
      "INVALID_REQUEST",
      `${field} must be 1-256 characters of letters, digits, or ._:/@-`,
    );
  }
}

function safeIdentifier(value: unknown): string | undefined {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value)
    ? value
    : undefined;
}
