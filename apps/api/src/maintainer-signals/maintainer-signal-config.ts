/**
 * Configuration surface for package maintainer change signals.
 *
 * Defaults are conservative so the feature is safe to enable without tuning.
 * Values are validated once; an invalid value throws a `RangeError` naming the
 * option instead of silently falling back.
 */

import {
  MaintainerSignalSeverity,
  SEVERITY_RANK,
} from "./maintainer-signal-types";

export interface MaintainerSignalConfig {
  /** Master switch. When false, submissions are refused with SIGNALS_DISABLED. */
  enabled: boolean;
  /**
   * Ecosystems (purl types) to look up. Packages from other ecosystems are
   * reported as skipped with UNSUPPORTED_ECOSYSTEM, never as failures.
   */
  supportedEcosystems: string[];
  /** Signals below this severity are left out of reports. */
  minSeverity: MaintainerSignalSeverity;
  /** Largest distinct package count per scan; larger requests are refused. */
  maxPackagesPerScan: number;
  /** Registry responses listing more maintainers are treated as invalid. */
  maxMaintainersPerPackage: number;
  /** Cap on skipped-package details kept per report (counts are always exact). */
  maxReportedSkips: number;
  /** Registry lookups in flight at once, per job. */
  lookupConcurrency: number;
  /** Per-lookup timeout; the provider receives an aborting signal. */
  lookupTimeoutMs: number;
  /** Tries per package lookup, including the first, for transient failures. */
  lookupMaxAttempts: number;
  /** Delay before the second lookup try; doubles on each further try. */
  lookupRetryBackoffMs: number;
  /**
   * Largest fraction (0-1) of looked-up packages that may fail transiently while
   * the report is still produced as `partial`. Above it the job fails with
   * LOOKUP_FAILURE_THRESHOLD and nothing is persisted.
   */
  maxFailedLookupRatio: number;
  /** Total job attempts, including the first, before dead-lettering. */
  maxAttempts: number;
  /** Delay before the first job retry; doubles on each further attempt. */
  retryBackoffMs: number;
  maxRetryBackoffMs: number;
  /** How long a worker may hold a job before another worker can take it over. */
  leaseTtlMs: number;
  maxPendingJobs: number;
  maxPendingJobsPerTenant: number;
  /** How long finished job records stay queryable. */
  finishedJobRetentionMs: number;
}

/** Ecosystems with a bundled registry provider. */
export const BUILTIN_MAINTAINER_ECOSYSTEMS: readonly string[] = Object.freeze([
  "cargo",
  "npm",
]);

export const DEFAULT_MAINTAINER_SIGNAL_CONFIG: Readonly<MaintainerSignalConfig> =
  Object.freeze({
    enabled: true,
    supportedEcosystems: [...BUILTIN_MAINTAINER_ECOSYSTEMS],
    minSeverity: "low" as MaintainerSignalSeverity,
    maxPackagesPerScan: 2_000,
    maxMaintainersPerPackage: 200,
    maxReportedSkips: 100,
    lookupConcurrency: 8,
    lookupTimeoutMs: 10_000,
    lookupMaxAttempts: 3,
    lookupRetryBackoffMs: 250,
    maxFailedLookupRatio: 0.2,
    maxAttempts: 3,
    retryBackoffMs: 5_000,
    maxRetryBackoffMs: 300_000,
    leaseTtlMs: 5 * 60_000,
    maxPendingJobs: 500,
    maxPendingJobsPerTenant: 50,
    finishedJobRetentionMs: 60 * 60 * 1000,
  });

const ENV_KEYS: Record<keyof MaintainerSignalConfig, string> = {
  enabled: "MAINTAINER_SIGNALS_ENABLED",
  supportedEcosystems: "MAINTAINER_SIGNALS_ECOSYSTEMS",
  minSeverity: "MAINTAINER_SIGNALS_MIN_SEVERITY",
  maxPackagesPerScan: "MAINTAINER_SIGNALS_MAX_PACKAGES",
  maxMaintainersPerPackage: "MAINTAINER_SIGNALS_MAX_MAINTAINERS",
  maxReportedSkips: "MAINTAINER_SIGNALS_MAX_REPORTED_SKIPS",
  lookupConcurrency: "MAINTAINER_SIGNALS_LOOKUP_CONCURRENCY",
  lookupTimeoutMs: "MAINTAINER_SIGNALS_LOOKUP_TIMEOUT_MS",
  lookupMaxAttempts: "MAINTAINER_SIGNALS_LOOKUP_MAX_ATTEMPTS",
  lookupRetryBackoffMs: "MAINTAINER_SIGNALS_LOOKUP_RETRY_BACKOFF_MS",
  maxFailedLookupRatio: "MAINTAINER_SIGNALS_MAX_FAILED_LOOKUP_RATIO",
  maxAttempts: "MAINTAINER_SIGNALS_MAX_ATTEMPTS",
  retryBackoffMs: "MAINTAINER_SIGNALS_RETRY_BACKOFF_MS",
  maxRetryBackoffMs: "MAINTAINER_SIGNALS_MAX_RETRY_BACKOFF_MS",
  leaseTtlMs: "MAINTAINER_SIGNALS_LEASE_TTL_MS",
  maxPendingJobs: "MAINTAINER_SIGNALS_MAX_PENDING_JOBS",
  maxPendingJobsPerTenant: "MAINTAINER_SIGNALS_MAX_PENDING_JOBS_PER_TENANT",
  finishedJobRetentionMs: "MAINTAINER_SIGNALS_FINISHED_JOB_RETENTION_MS",
};

const ECOSYSTEM_PATTERN = /^[a-z][a-z0-9.+-]{0,31}$/;

/** Merge `overrides` over the defaults and validate the result. */
export function resolveMaintainerSignalConfig(
  overrides: Partial<MaintainerSignalConfig> = {},
): MaintainerSignalConfig {
  const config: MaintainerSignalConfig = {
    ...DEFAULT_MAINTAINER_SIGNAL_CONFIG,
    ...stripUndefined(overrides),
  };

  if (typeof config.enabled !== "boolean") {
    throw new RangeError("enabled must be a boolean");
  }
  if (
    !Array.isArray(config.supportedEcosystems) ||
    !config.supportedEcosystems.every(
      (e) => typeof e === "string" && ECOSYSTEM_PATTERN.test(e),
    )
  ) {
    throw new RangeError(
      "supportedEcosystems must be a list of lower-case purl types",
    );
  }
  config.supportedEcosystems = [...new Set(config.supportedEcosystems)].sort();
  if (
    !Object.prototype.hasOwnProperty.call(SEVERITY_RANK, config.minSeverity)
  ) {
    throw new RangeError("minSeverity must be one of info, low, medium, high");
  }
  for (const field of [
    "maxPackagesPerScan",
    "maxMaintainersPerPackage",
    "lookupConcurrency",
    "lookupTimeoutMs",
    "lookupMaxAttempts",
    "maxAttempts",
    "leaseTtlMs",
    "maxPendingJobs",
    "maxPendingJobsPerTenant",
    "finishedJobRetentionMs",
  ] as const) {
    requirePositiveInteger(config[field], field);
  }
  for (const field of [
    "maxReportedSkips",
    "lookupRetryBackoffMs",
    "retryBackoffMs",
    "maxRetryBackoffMs",
  ] as const) {
    requireNonNegativeInteger(config[field], field);
  }
  if (
    typeof config.maxFailedLookupRatio !== "number" ||
    !Number.isFinite(config.maxFailedLookupRatio) ||
    config.maxFailedLookupRatio < 0 ||
    config.maxFailedLookupRatio > 1
  ) {
    throw new RangeError(
      "maxFailedLookupRatio must be a number between 0 and 1",
    );
  }
  if (config.maxRetryBackoffMs < config.retryBackoffMs) {
    throw new RangeError("maxRetryBackoffMs must be >= retryBackoffMs");
  }
  if (config.maxPendingJobsPerTenant > config.maxPendingJobs) {
    throw new RangeError("maxPendingJobsPerTenant must be <= maxPendingJobs");
  }
  return config;
}

/**
 * Build a config from `MAINTAINER_SIGNALS_*` environment variables. Unset or
 * empty variables keep their defaults; unparseable values throw at startup.
 */
export function loadMaintainerSignalConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): MaintainerSignalConfig {
  const overrides: Partial<MaintainerSignalConfig> = {};
  for (const [field, envKey] of Object.entries(ENV_KEYS) as [
    keyof MaintainerSignalConfig,
    string,
  ][]) {
    const raw = env[envKey];
    if (raw === undefined || raw.trim() === "") {
      continue;
    }
    const value = raw.trim();
    if (field === "enabled") {
      overrides.enabled = parseBoolean(value, envKey);
    } else if (field === "supportedEcosystems") {
      overrides.supportedEcosystems = value
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e !== "");
    } else if (field === "minSeverity") {
      overrides.minSeverity = value.toLowerCase() as MaintainerSignalSeverity;
    } else {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw new RangeError(`${envKey} must be a number`);
      }
      (overrides as Record<string, number>)[field] = parsed;
    }
  }
  return resolveMaintainerSignalConfig(overrides);
}

function parseBoolean(value: string, envKey: string): boolean {
  const lowered = value.toLowerCase();
  if (["true", "1", "yes", "on"].includes(lowered)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(lowered)) {
    return false;
  }
  throw new RangeError(`${envKey} must be a boolean`);
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

function requirePositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive integer`);
  }
}

function requireNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative integer`);
  }
}
