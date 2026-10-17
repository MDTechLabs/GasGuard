/**
 * Shared types for package maintainer change signals.
 *
 * For every dependency of a scanned repository, GasGuard records who maintains
 * the package in its registry. On the next scan of the same repository the
 * current maintainer set is compared with that baseline, and changes that are
 * known precursors of supply-chain compromise (ownership transfer, a publisher
 * nobody had seen before, an account whose email domain moved) are reported as
 * signals on the scan.
 *
 * Identities are registry handles, which registries publish openly. Email
 * addresses are never stored, logged, or reported: only a SHA-256 digest of the
 * email *domain* is kept, which is enough to notice that a domain changed.
 */

/** Package ecosystem, using purl type names. */
export type MaintainerEcosystem = string;

export interface PackageRef {
  ecosystem: MaintainerEcosystem;
  /**
   * Registry name, including any scope or namespace exactly as the registry
   * spells it (`@scope/name` for npm).
   */
  name: string;
  /** Resolved version; enables the publisher check when present. */
  version?: string;
}

export interface MaintainerIdentity {
  /** Registry handle, trimmed and lower-cased. */
  handle: string;
  /** SHA-256 hex digest of the lower-cased email domain, when the registry exposes one. */
  emailDomainDigest?: string;
}

/** What a registry reported about one package at one point in time. */
export interface PackageMaintainerSnapshot {
  /** Sorted by handle, unique. */
  maintainers: MaintainerIdentity[];
  /** Handle that published `PackageRef.version`, when known. */
  publisher?: string;
}

export type MaintainerSignalType =
  /** One or more maintainers appear that were not in the baseline. */
  | "MAINTAINER_ADDED"
  /** One or more baseline maintainers are gone. */
  | "MAINTAINER_REMOVED"
  /** Every baseline maintainer is gone and someone else now owns the package. */
  | "OWNERSHIP_TRANSFERRED"
  /** A maintainer kept their handle but their email domain changed. */
  | "MAINTAINER_EMAIL_DOMAIN_CHANGED"
  /** The resolved version was published by someone not in the baseline. */
  | "PUBLISHED_BY_NEW_MAINTAINER";

export type MaintainerSignalSeverity = "info" | "low" | "medium" | "high";

export const SEVERITY_RANK: Readonly<Record<MaintainerSignalSeverity, number>> =
  Object.freeze({ info: 0, low: 1, medium: 2, high: 3 });

export const DEFAULT_SIGNAL_SEVERITY: Readonly<
  Record<MaintainerSignalType, MaintainerSignalSeverity>
> = Object.freeze({
  MAINTAINER_ADDED: "low",
  MAINTAINER_REMOVED: "low",
  OWNERSHIP_TRANSFERRED: "high",
  MAINTAINER_EMAIL_DOMAIN_CHANGED: "medium",
  PUBLISHED_BY_NEW_MAINTAINER: "medium",
});

export interface MaintainerSignal {
  type: MaintainerSignalType;
  severity: MaintainerSignalSeverity;
  ecosystem: MaintainerEcosystem;
  package: string;
  version?: string;
  /** Handles involved in the change, sorted. Never contains email data. */
  handles: string[];
  /** When the compared baseline was observed (epoch ms). */
  baselineObservedAt: number;
}

export type PackageSkipReason =
  /** Ecosystem not in `supportedEcosystems`, or no provider registered for it. */
  | "UNSUPPORTED_ECOSYSTEM"
  /** The registry does not know the package (private or removed). */
  | "NOT_FOUND"
  /** The registry response was malformed or exceeded `maxMaintainersPerPackage`. */
  | "INVALID_METADATA"
  /** The lookup kept failing after `lookupMaxAttempts` tries. */
  | "LOOKUP_FAILED";

export interface SkippedPackage {
  ecosystem: MaintainerEcosystem;
  package: string;
  reason: PackageSkipReason;
}

export interface MaintainerSignalStats {
  /** Distinct packages requested. */
  packages: number;
  /** Packages compared against an existing baseline. */
  compared: number;
  /** Packages seen for the first time; baseline recorded, no signals possible. */
  baselined: number;
  /** Packages whose maintainers changed since the baseline. */
  changed: number;
  skipped: number;
  /** Lookups that failed transiently (subset of `skipped`). */
  lookupFailures: number;
}

/** Per-scan result, persisted and returned to the reporting layer. */
export interface MaintainerSignalReport {
  /** Bumped on any breaking change to this shape. */
  schemaVersion: 1;
  tenantId: string;
  repositoryId: string;
  scanId: string;
  jobId: string;
  /** Submission sequence that produced the report; orders concurrent writes. */
  revision: number;
  analyzedAt: number;
  /** `partial` when at least one package was skipped for a lookup failure. */
  status: "complete" | "partial";
  /** Sorted by severity (highest first), then ecosystem, package, type. */
  signals: MaintainerSignal[];
  /** Sorted by ecosystem, package. First `maxReportedSkips` only; counts are exact. */
  skipped: SkippedPackage[];
  stats: MaintainerSignalStats;
}

export type MaintainerSignalErrorCode =
  /** Feature switched off by configuration. */
  | "SIGNALS_DISABLED"
  /** Tenant, repository, or scan id missing or malformed, or bad package list. */
  | "INVALID_REQUEST"
  /** More distinct packages than `maxPackagesPerScan`. */
  | "TOO_MANY_PACKAGES"
  /** `fromSbom` requested but the scan has no ingested SBOM (yet). */
  | "SBOM_NOT_FOUND"
  /** A different package set is already being analyzed for this scan. */
  | "CONFLICT"
  /** Global or per-tenant pending-job limit reached. */
  | "QUEUE_FULL"
  /** Failed lookups exceeded `maxFailedLookupRatio`; nothing was persisted. */
  | "LOOKUP_FAILURE_THRESHOLD"
  /** Reading or writing baselines or reports failed. */
  | "STORAGE_FAILURE"
  /** The worker's lease expired before it finished. */
  | "LEASE_EXPIRED";

const RETRYABLE_CODES: ReadonlySet<MaintainerSignalErrorCode> =
  new Set<MaintainerSignalErrorCode>([
    "SBOM_NOT_FOUND",
    "QUEUE_FULL",
    "LOOKUP_FAILURE_THRESHOLD",
    "STORAGE_FAILURE",
    "LEASE_EXPIRED",
  ]);

/**
 * Error raised by every maintainer-signal boundary. Messages are fixed strings
 * that never echo registry data, so the error is safe to log or return.
 */
export class MaintainerSignalError extends Error {
  readonly code: MaintainerSignalErrorCode;
  readonly retryable: boolean;

  constructor(code: MaintainerSignalErrorCode, message: string) {
    super(message);
    this.name = "MaintainerSignalError";
    this.code = code;
    this.retryable = RETRYABLE_CODES.has(code);
  }
}

export function isRetryableMaintainerSignalError(
  code: MaintainerSignalErrorCode,
): boolean {
  return RETRYABLE_CODES.has(code);
}
