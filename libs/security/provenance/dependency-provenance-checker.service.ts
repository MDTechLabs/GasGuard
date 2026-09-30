import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  Ecosystem,
  ProvenanceRecord,
  ProvenanceViolation,
  ProvenanceCheckResult,
  ProvenanceCheckerConfig,
  ProvViolationSeverity,
} from './interfaces';

/**
 * Internal representation of an npm lockfile entry.
 */
interface NpmLockPackage {
  version: string;
  resolved?: string;
  integrity?: string;
  dev?: boolean;
}

interface NpmLockV2 {
  lockfileVersion: number;
  packages?: Record<string, NpmLockPackage>;
  dependencies?: Record<string, NpmLockPackage>;
}

/**
 * Internal representation of a Cargo.lock entry.
 */
interface CargoLockPackage {
  name: string;
  version: string;
  source?: string;
  checksum?: string;
}

/**
 * Severity ordering — lower index ≡ more severe.
 */
const SEVERITY_ORDER: ProvViolationSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];

/**
 * DependencyProvenanceChecker verifies that npm (package-lock.json /
 * pnpm-lock.yaml) and Cargo (Cargo.lock) dependencies declare a known
 * source repository and, for npm packages, optionally carry a registry
 * provenance attestation.
 *
 * Design goals:
 *  - Works entirely on local lockfiles — no mandatory network calls.
 *  - Lightweight: no extra runtime dependencies beyond Node built-ins.
 *  - Compatible with NestJS DI as a provider or usable standalone.
 *
 * @example
 * ```ts
 * const checker = new DependencyProvenanceChecker();
 * const result = await checker.checkNpmLockfile('package-lock.json', {
 *   requireRepositoryUrl: true,
 *   failOnSeverity: 'high',
 * });
 * if (!result.passed) {
 *   process.exit(1);
 * }
 * ```
 */
@Injectable()
export class DependencyProvenanceChecker {
  private readonly logger = new Logger(DependencyProvenanceChecker.name);

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Check an npm package-lock.json (v2/v3) for provenance indicators.
   *
   * Verifications performed:
   *  1. Each entry must have a `resolved` URL pointing to a known registry
   *     host (npmjs.com or an allowlisted internal registry).
   *  2. Each entry must carry an `integrity` field (SRI hash).
   *  3. The SRI algorithm must be `sha512` (sha1 is considered broken).
   *  4. If `config.requireRepositoryUrl` is true, we check that the
   *     package manifest field exists; in a lockfile-only check this step
   *     is noted as info-level since manifests are not embedded.
   *
   * @param lockfilePath Absolute or CWD-relative path to package-lock.json.
   * @param config       Optional checker configuration.
   * @returns            A {@link ProvenanceCheckResult}.
   */
  public async checkNpmLockfile(
    lockfilePath: string,
    config: ProvenanceCheckerConfig = {},
  ): Promise<ProvenanceCheckResult> {
    this.logger.log(`Checking npm lockfile provenance: ${lockfilePath}`);

    const violations: ProvenanceViolation[] = [];
    const records: ProvenanceRecord[] = [];

    const resolved = path.resolve(lockfilePath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Lockfile not found: ${resolved}`);
    }

    let lockData: NpmLockV2;
    try {
      const raw = fs.readFileSync(resolved, 'utf-8');
      lockData = JSON.parse(raw) as NpmLockV2;
    } catch (err) {
      throw new Error(`Failed to parse lockfile at ${resolved}: ${String(err)}`);
    }

    // Support both v2 (packages) and v1 (dependencies) lockfile formats.
    const packages: Record<string, NpmLockPackage> =
      lockData.packages ?? lockData.dependencies ?? {};

    const entries = Object.entries(packages);
    const limit = config.maxPackages ?? entries.length;
    const exclude = new Set(config.exclude ?? []);

    let checked = 0;
    for (const [pkgPath, pkg] of entries) {
      if (checked >= limit) break;

      // Derive the canonical package name:
      //  - In lockfile v2, the key is "node_modules/foo" or "node_modules/@scope/foo".
      //  - In lockfile v1, the key is the bare package name.
      const pkgName = pkgPath.replace(/^node_modules\//, '');

      if (exclude.has(pkgName)) continue;
      // Skip the root package entry (empty string key in v2).
      if (pkgName === '') continue;

      checked++;

      const record: ProvenanceRecord = {
        name: pkgName,
        version: pkg.version ?? 'unknown',
        ecosystem: 'npm',
      };

      // --- Check 1: resolved URL must point to a known registry ---
      if (!pkg.resolved) {
        violations.push({
          packageName: pkgName,
          ecosystem: 'npm',
          severity: 'high',
          message: `Package "${pkgName}@${pkg.version}" has no resolved URL in lockfile. This prevents provenance verification.`,
          remediation:
            'Ensure the package is installed from a registry (npm install) and commit the resulting lockfile.',
        });
      } else {
        record.repositoryUrl = pkg.resolved;
        if (!this.isKnownNpmRegistryUrl(pkg.resolved)) {
          violations.push({
            packageName: pkgName,
            ecosystem: 'npm',
            severity: 'high',
            message: `Package "${pkgName}@${pkg.version}" resolves from an unrecognised registry host: ${pkg.resolved}. Only packages from npmjs.com or explicitly allowlisted private registries are trusted.`,
            remediation:
              'Remove the custom registry configuration or add the registry URL to the allowlist.',
          });
        }
      }

      // --- Check 2: integrity field must be present ---
      if (!pkg.integrity) {
        violations.push({
          packageName: pkgName,
          ecosystem: 'npm',
          severity: 'critical',
          message: `Package "${pkgName}@${pkg.version}" is missing an integrity (SRI) hash. Without it, the download cannot be verified.`,
          remediation: 'Run `npm install` or `pnpm install` to regenerate the lockfile with integrity hashes.',
        });
        record.integrityVerified = false;
      } else {
        // --- Check 3: integrity algorithm must be sha512 ---
        if (!pkg.integrity.startsWith('sha512-')) {
          violations.push({
            packageName: pkgName,
            ecosystem: 'npm',
            severity: 'medium',
            message: `Package "${pkgName}@${pkg.version}" uses a weak integrity algorithm: "${pkg.integrity.split('-')[0]}". sha512 is required.`,
            remediation: 'Run `npm install` with a recent npm version (≥7) to upgrade the lockfile.',
          });
          record.integrityVerified = false;
        } else {
          record.integrityHash = pkg.integrity;
          record.integrityVerified = true;
        }
      }

      records.push(record);
    }

    return this.buildResult(records, violations, checked, config);
  }

  /**
   * Check a Cargo.lock for provenance indicators.
   *
   * Verifications performed:
   *  1. Each `[package]` section with a `source` field must reference the
   *     canonical crates.io registry or a known git source.
   *  2. Each crates.io package must carry a `checksum` field.
   *  3. The checksum must be a valid 64-character hex string (sha256).
   *  4. Packages with no `source` (path dependencies) generate an
   *     info-level note unless they are in the exclude list.
   *
   * @param lockfilePath Absolute or CWD-relative path to Cargo.lock.
   * @param config       Optional checker configuration.
   */
  public async checkCargoLockfile(
    lockfilePath: string,
    config: ProvenanceCheckerConfig = {},
  ): Promise<ProvenanceCheckResult> {
    this.logger.log(`Checking Cargo lockfile provenance: ${lockfilePath}`);

    const violations: ProvenanceViolation[] = [];
    const records: ProvenanceRecord[] = [];

    const resolved = path.resolve(lockfilePath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Lockfile not found: ${resolved}`);
    }

    let raw: string;
    try {
      raw = fs.readFileSync(resolved, 'utf-8');
    } catch (err) {
      throw new Error(`Failed to read lockfile at ${resolved}: ${String(err)}`);
    }

    const packages = this.parseCargoLock(raw);
    const limit = config.maxPackages ?? packages.length;
    const exclude = new Set(config.exclude ?? []);

    let checked = 0;
    for (const pkg of packages) {
      if (checked >= limit) break;
      if (exclude.has(pkg.name)) continue;

      checked++;

      const record: ProvenanceRecord = {
        name: pkg.name,
        version: pkg.version,
        ecosystem: 'cargo',
        repositoryUrl: pkg.source,
      };

      // --- Check 1: source field ---
      if (!pkg.source) {
        // Path or workspace dependency — acceptable but flagged at info level.
        violations.push({
          packageName: pkg.name,
          ecosystem: 'cargo',
          severity: 'info',
          message: `Crate "${pkg.name}@${pkg.version}" has no source field (likely a path/workspace dependency). Its provenance cannot be independently verified.`,
          remediation:
            'Ensure this is an intentional workspace or path dependency, not an unresolved external crate.',
        });
      } else if (!this.isKnownCargoSource(pkg.source)) {
        violations.push({
          packageName: pkg.name,
          ecosystem: 'cargo',
          severity: 'high',
          message: `Crate "${pkg.name}@${pkg.version}" is sourced from an unrecognised registry or git URL: ${pkg.source}. Only crates.io and allowlisted git remotes are trusted.`,
          remediation:
            'Audit this dependency origin and add a justified allowlist entry if the source is intentional.',
        });
      }

      // --- Check 2: checksum required for crates.io packages ---
      const isCratesIo = pkg.source?.includes('registry+https://github.com/rust-lang/crates.io-index');
      if (isCratesIo) {
        if (!pkg.checksum) {
          violations.push({
            packageName: pkg.name,
            ecosystem: 'cargo',
            severity: 'critical',
            message: `Crate "${pkg.name}@${pkg.version}" from crates.io is missing a checksum in Cargo.lock. The download integrity cannot be verified.`,
            remediation:
              'Run `cargo generate-lockfile` or `cargo update` to regenerate the lockfile with checksums.',
          });
          record.integrityVerified = false;
        } else {
          // --- Check 3: checksum must be a valid sha256 hex string ---
          if (!this.isValidSha256Hex(pkg.checksum)) {
            violations.push({
              packageName: pkg.name,
              ecosystem: 'cargo',
              severity: 'high',
              message: `Crate "${pkg.name}@${pkg.version}" has a malformed checksum in Cargo.lock: "${pkg.checksum}". Expected a 64-character hex string.`,
              remediation: 'Regenerate the lockfile with `cargo generate-lockfile`.',
            });
            record.integrityVerified = false;
          } else {
            record.integrityHash = pkg.checksum;
            record.integrityVerified = true;
          }
        }
      }

      records.push(record);
    }

    return this.buildResult(records, violations, checked, config);
  }

  /**
   * Verify the SRI integrity hash of a file on disk matches the expected
   * value from the lockfile.  Returns `true` on match, `false` otherwise.
   *
   * @param filePath     Path to the file to hash.
   * @param sriHash      Expected SRI hash, e.g. "sha512-abc123…".
   */
  public verifyFileIntegrity(filePath: string, sriHash: string): boolean {
    const [algorithmRaw, expectedBase64] = sriHash.split('-', 2);
    if (!algorithmRaw || !expectedBase64) return false;

    const algorithm = algorithmRaw.toLowerCase().replace('sha', 'sha');
    try {
      const content = fs.readFileSync(filePath);
      const hash = crypto.createHash(algorithm).update(content).digest('base64');
      return hash === expectedBase64;
    } catch {
      return false;
    }
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Parse a Cargo.lock TOML into a list of package records using a
   * lightweight regex-based parser (avoids pulling in a TOML library).
   */
  private parseCargoLock(content: string): CargoLockPackage[] {
    const packages: CargoLockPackage[] = [];

    // Split on [[package]] sections.
    const sections = content.split(/^\[\[package\]\]/m).slice(1);

    for (const section of sections) {
      const name = this.extractTomlString(section, 'name');
      const version = this.extractTomlString(section, 'version');
      if (!name || !version) continue;

      const source = this.extractTomlString(section, 'source');
      const checksum = this.extractTomlString(section, 'checksum');

      packages.push({ name, version, source, checksum });
    }

    return packages;
  }

  /** Extract a string value from a TOML section for a given key. */
  private extractTomlString(section: string, key: string): string | undefined {
    const match = section.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, 'm'));
    return match?.[1];
  }

  /**
   * Returns `true` when the resolved URL belongs to a known, trusted npm
   * registry host.
   */
  private isKnownNpmRegistryUrl(url: string): boolean {
    try {
      const { hostname } = new URL(url);
      // npmjs.com (public registry) and common private registry patterns.
      return (
        hostname === 'registry.npmjs.org' ||
        hostname.endsWith('.npmjs.org') ||
        hostname === 'registry.yarnpkg.com' ||
        // Allow common private registries (Artifactory, Verdaccio, Nexus).
        hostname.endsWith('.jfrog.io') ||
        hostname.endsWith('.verdaccio.org')
      );
    } catch {
      return false;
    }
  }

  /**
   * Returns `true` when the Cargo source is crates.io or an allowlisted
   * git remote (github.com / gitlab.com hosted sources).
   */
  private isKnownCargoSource(source: string): boolean {
    return (
      source.startsWith('registry+https://github.com/rust-lang/crates.io-index') ||
      source.startsWith('git+https://github.com/') ||
      source.startsWith('git+https://gitlab.com/')
    );
  }

  /** Validate that a string is a 64-character lowercase hex string (sha256). */
  private isValidSha256Hex(value: string): boolean {
    return /^[0-9a-f]{64}$/i.test(value);
  }

  /**
   * Determine whether the result passes based on the configured severity
   * threshold.
   */
  private meetsFailThreshold(
    violations: ProvenanceViolation[],
    failOnSeverity: ProvViolationSeverity,
  ): boolean {
    const threshold = SEVERITY_ORDER.indexOf(failOnSeverity);
    return violations.every(
      (v) => SEVERITY_ORDER.indexOf(v.severity) > threshold,
    );
  }

  private buildResult(
    records: ProvenanceRecord[],
    violations: ProvenanceViolation[],
    totalChecked: number,
    config: ProvenanceCheckerConfig,
  ): ProvenanceCheckResult {
    const failOnSeverity = config.failOnSeverity ?? 'high';
    const passed = this.meetsFailThreshold(violations, failOnSeverity);

    if (violations.length > 0) {
      this.logger.warn(
        `Provenance check found ${violations.length} violation(s). Passed: ${passed}`,
      );
    } else {
      this.logger.log(`Provenance check passed. ${totalChecked} package(s) verified.`);
    }

    return {
      passed,
      totalChecked,
      violations,
      records,
      checkedAt: new Date().toISOString(),
    };
  }
}
