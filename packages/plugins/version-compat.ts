/**
 * Version compatibility utilities
 * Handles semantic versioning and compatibility checking
 */

import { SemanticVersion, VersionRange } from './plugin-manifest';

/**
 * Represents a semantic version
 */
export class Version {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
  metadata?: string;

  constructor(versionString: SemanticVersion) {
    const version = Version.parse(versionString);
    this.major = version.major;
    this.minor = version.minor;
    this.patch = version.patch;
    this.prerelease = version.prerelease;
    this.metadata = version.metadata;
  }

  /**
   * Parse semantic version string
   */
  static parse(versionString: SemanticVersion): Version {
    // Pattern: MAJOR.MINOR.PATCH[-PRERELEASE][+METADATA]
    const regex =
      /^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.-]+))?(?:\+([a-zA-Z0-9.-]+))?$/;
    const match = versionString.match(regex);

    if (!match) {
      throw new Error(`Invalid semantic version: ${versionString}`);
    }

    const version = new Version('0.0.0');
    version.major = parseInt(match[1], 10);
    version.minor = parseInt(match[2], 10);
    version.patch = parseInt(match[3], 10);
    version.prerelease = match[4];
    version.metadata = match[5];

    return version;
  }

  /**
   * Get string representation
   */
  toString(): string {
    let version = `${this.major}.${this.minor}.${this.patch}`;
    if (this.prerelease) {
      version += `-${this.prerelease}`;
    }
    if (this.metadata) {
      version += `+${this.metadata}`;
    }
    return version;
  }

  /**
   * Compare two versions
   * Returns: -1 if this < other, 0 if equal, 1 if this > other
   */
  compare(other: Version): -1 | 0 | 1 {
    // Compare major.minor.patch ignoring prerelease
    if (this.major !== other.major) {
      return this.major < other.major ? -1 : 1;
    }
    if (this.minor !== other.minor) {
      return this.minor < other.minor ? -1 : 1;
    }
    if (this.patch !== other.patch) {
      return this.patch < other.patch ? -1 : 1;
    }

    // Compare prerelease versions
    // Version without prerelease > version with prerelease
    if (!this.prerelease && other.prerelease) return 1;
    if (this.prerelease && !other.prerelease) return -1;
    if (this.prerelease && other.prerelease) {
      return this.prerelease.localeCompare(other.prerelease) as -1 | 0 | 1;
    }

    return 0;
  }

  /**
   * Check if this version is greater than other
   */
  isGreaterThan(other: Version): boolean {
    return this.compare(other) > 0;
  }

  /**
   * Check if this version is greater than or equal to other
   */
  isGreaterThanOrEqual(other: Version): boolean {
    return this.compare(other) >= 0;
  }

  /**
   * Check if this version is less than other
   */
  isLessThan(other: Version): boolean {
    return this.compare(other) < 0;
  }

  /**
   * Check if this version is less than or equal to other
   */
  isLessThanOrEqual(other: Version): boolean {
    return this.compare(other) <= 0;
  }

  /**
   * Check if this version equals other
   */
  equals(other: Version): boolean {
    return this.compare(other) === 0;
  }

  /**
   * Increment patch version (0.0.1 -> 0.0.2)
   */
  nextPatch(): Version {
    const v = new Version('0.0.0');
    v.major = this.major;
    v.minor = this.minor;
    v.patch = this.patch + 1;
    return v;
  }

  /**
   * Increment minor version (0.1.0 -> 0.2.0)
   */
  nextMinor(): Version {
    const v = new Version('0.0.0');
    v.major = this.major;
    v.minor = this.minor + 1;
    v.patch = 0;
    return v;
  }

  /**
   * Increment major version (1.0.0 -> 2.0.0)
   */
  nextMajor(): Version {
    const v = new Version('0.0.0');
    v.major = this.major + 1;
    v.minor = 0;
    v.patch = 0;
    return v;
  }
}

/**
 * Version range matcher
 */
export class VersionMatcher {
  /**
   * Check if version satisfies range
   * Range: { min: "1.0.0", max: "2.0.0" }
   * Matches: >= 1.0.0 and < 2.0.0
   */
  static satisfies(version: SemanticVersion, range: VersionRange): boolean {
    const ver = new Version(version);
    const min = new Version(range.min);

    // Check minimum version (inclusive)
    if (ver.isLessThan(min)) {
      return false;
    }

    // Check maximum version (exclusive)
    if (range.max) {
      const max = new Version(range.max);
      if (ver.isGreaterThanOrEqual(max)) {
        return false;
      }
    }

    // Check excluded versions
    if (range.excludeVersions) {
      for (const excluded of range.excludeVersions) {
        if (ver.equals(new Version(excluded))) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Check if version range is compatible with another
   * Ranges overlap if there's at least one version satisfying both
   */
  static rangesCompatible(range1: VersionRange, range2: VersionRange): boolean {
    const min1 = new Version(range1.min);
    const min2 = new Version(range2.min);

    // Use the larger minimum
    const effectiveMin = min1.isGreaterThan(min2) ? min1 : min2;

    // Use the smaller maximum (or no max)
    let effectiveMax: Version | null = null;
    if (range1.max && range2.max) {
      const max1 = new Version(range1.max);
      const max2 = new Version(range2.max);
      effectiveMax = max1.isLessThan(max2) ? max1 : max2;
    } else if (range1.max) {
      effectiveMax = new Version(range1.max);
    } else if (range2.max) {
      effectiveMax = new Version(range2.max);
    }

    // Check if range is valid (min < max)
    if (effectiveMax && !effectiveMin.isLessThan(effectiveMax)) {
      return false;
    }

    return true;
  }

  /**
   * Find compatible version from list
   */
  static findCompatible(
    versions: SemanticVersion[],
    range: VersionRange,
  ): SemanticVersion | null {
    // Sort versions descending
    const sorted = [...versions]
      .map((v) => new Version(v))
      .sort((a, b) => b.compare(a));

    for (const version of sorted) {
      if (this.satisfies(version.toString(), range)) {
        return version.toString();
      }
    }

    return null;
  }
}

/**
 * Compatibility check results
 */
export interface CompatibilityCheckResult {
  compatible: boolean;
  errors: string[];
  warnings: string[];
  suggestions?: string[];
}

/**
 * Version compatibility checker
 */
export class CompatibilityChecker {
  /**
   * Check if plugin version is compatible with core version
   */
  static checkCoreCompatibility(
    pluginVersion: SemanticVersion,
    coreVersion: SemanticVersion,
    requiredRange: VersionRange,
  ): CompatibilityCheckResult {
    const result: CompatibilityCheckResult = {
      compatible: false,
      errors: [],
      warnings: [],
    };

    // Check if required version range is supported
    if (!VersionMatcher.satisfies(coreVersion, requiredRange)) {
      result.errors.push(
        `GasGuard core version ${coreVersion} does not satisfy ` +
          `required range ${requiredRange.min}..${requiredRange.max || '*'}`,
      );
    } else {
      result.compatible = true;
    }

    return result;
  }

  /**
   * Check dependency compatibility
   */
  static checkDependencyCompatibility(
    depVersion: SemanticVersion,
    requiredRange: VersionRange,
  ): CompatibilityCheckResult {
    const result: CompatibilityCheckResult = {
      compatible: VersionMatcher.satisfies(depVersion, requiredRange),
      errors: [],
      warnings: [],
    };

    if (!result.compatible) {
      result.errors.push(
        `Dependency version ${depVersion} does not satisfy ` +
          `required range ${requiredRange.min}..${requiredRange.max || '*'}`,
      );
    }

    return result;
  }

  /**
   * Check if plugins conflict
   */
  static checkConflicts(
    conflicts: string[],
    loadedPlugins: Map<string, SemanticVersion>,
  ): CompatibilityCheckResult {
    const result: CompatibilityCheckResult = {
      compatible: true,
      errors: [],
      warnings: [],
    };

    for (const conflictId of conflicts) {
      if (loadedPlugins.has(conflictId)) {
        const conflictVersion = loadedPlugins.get(conflictId)!;
        result.errors.push(
          `Plugin conflicts with already-loaded plugin ${conflictId}@${conflictVersion}`,
        );
        result.compatible = false;
      }
    }

    return result;
  }
}
