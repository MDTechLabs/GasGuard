/**
 * Interfaces and types for dependency provenance verification.
 *
 * Provenance refers to the verified origin and integrity of a software
 * dependency — ensuring a package was published by its expected author,
 * from a known source repository, without supply-chain tampering.
 *
 * @module libs/security/provenance
 */

/** Supported package ecosystems. */
export type Ecosystem = 'npm' | 'cargo';

/** Severity of a provenance finding. */
export type ProvViolationSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/**
 * Metadata that can be used to verify a dependency's provenance.
 */
export interface ProvenanceRecord {
  /** Package name, e.g. "@nestjs/common" or "serde". */
  name: string;
  /** Exact version string. */
  version: string;
  /** Package ecosystem. */
  ecosystem: Ecosystem;
  /**
   * Whether the package was published with an npm provenance attestation
   * (npm ≥ 9.5 / registry v1 attestation endpoint) or a Cargo crate
   * signature in the future.  Currently, Cargo attestation is not yet
   * mainstreamed, so this field is populated only for npm.
   */
  hasAttestation?: boolean;
  /**
   * The source-repository URL declared in the package manifest, if any.
   */
  repositoryUrl?: string;
  /**
   * SHA-256 / SHA-512 digest (hex) of the downloaded tarball/crate.
   * Populated during integrity verification.
   */
  integrityHash?: string;
  /**
   * Whether the integrity hash matches the registry-published digest.
   */
  integrityVerified?: boolean;
}

/**
 * A single provenance violation found during a check.
 */
export interface ProvenanceViolation {
  /** Affected package. */
  packageName: string;
  /** Ecosystem of the affected package. */
  ecosystem: Ecosystem;
  /** Human-readable description of the violation. */
  message: string;
  /** Severity classification. */
  severity: ProvViolationSeverity;
  /**
   * Optional remediation advice (shown in CI output and documentation).
   */
  remediation?: string;
}

/**
 * Result returned by the provenance checker for a given lockfile or manifest.
 */
export interface ProvenanceCheckResult {
  /** Whether all checks passed (no critical or high violations). */
  passed: boolean;
  /** Total number of dependencies examined. */
  totalChecked: number;
  /** List of violations found. */
  violations: ProvenanceViolation[];
  /** Per-package records (may be partial if a network call failed). */
  records: ProvenanceRecord[];
  /** ISO-8601 timestamp of when the check was run. */
  checkedAt: string;
}

/**
 * Configuration for the provenance checker.
 */
export interface ProvenanceCheckerConfig {
  /**
   * Fail the check (i.e. set `passed = false`) only when violations of at
   * least this severity are found.  Defaults to `'high'`.
   */
  failOnSeverity?: ProvViolationSeverity;
  /**
   * When `true`, packages that are missing a source-repository URL in their
   * manifest are flagged as a `'medium'` violation.  Defaults to `false`.
   */
  requireRepositoryUrl?: boolean;
  /**
   * When `true`, npm packages that lack a published provenance attestation
   * are flagged as a `'medium'` violation.  Defaults to `false`.
   */
  requireNpmAttestation?: boolean;
  /**
   * Package names to exclude from provenance checks (e.g. internal
   * monorepo packages that will never be in a registry).
   */
  exclude?: string[];
  /**
   * Maximum number of packages to verify in a single run.  Useful for
   * large dependency trees where full verification would be too slow.
   * Defaults to unlimited.
   */
  maxPackages?: number;
}
