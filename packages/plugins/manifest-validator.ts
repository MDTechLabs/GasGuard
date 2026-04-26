/**
 * Plugin manifest validation utilities
 * Validates plugin formats and compatibility
 */

import { PluginManifest, PluginRuleDefinition } from './plugin-manifest';
import { CompatibilityCheckResult, CompatibilityChecker } from './version-compat';
import { optimizePluginRules } from './rule-set-optimizer';

export interface ValidationError {
  field: string;
  error: string;
  severity: 'error' | 'warning';
}

export interface ManifestValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

/**
 * Validates plugin manifest format and content
 */
export class ManifestValidator {
  /**
   * Validate complete manifest
   */
  static validate(manifest: any): ManifestValidationResult {
    const result: ManifestValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
    };

    // Check required fields
    const requiredFields: (keyof PluginManifest)[] = [
      'id',
      'name',
      'version',
      'description',
      'languages',
      'capabilities',
      'main',
      'gasguardVersion',
    ];

    for (const field of requiredFields) {
      if (!manifest[field]) {
        result.errors.push({
          field: field as string,
          error: `Required field '${field}' is missing`,
          severity: 'error',
        });
        result.valid = false;
      }
    }

    if (manifest.id) {
      this.validateId(manifest, result);
    }
    if (manifest.version) {
      this.validateVersion(manifest, result);
    }
    if (manifest.languages) {
      this.validateLanguages(manifest, result);
    }
    if (manifest.capabilities) {
      this.validateCapabilities(manifest, result);
    }
    if (manifest.gasguardVersion) {
      this.validateVersionRange(manifest, result);
    }
    if (manifest.author) {
      this.validateContact(manifest.author, 'author', result);
    }
    if (manifest.support) {
      this.validateContact(manifest.support, 'support', result);
    }
    if (manifest.repository) {
      this.validateRepository(manifest, result);
    }
    if (manifest.dependencies) {
      this.validateDependencies(manifest, result);
    }
    if (manifest.peerDependencies) {
      this.validatePeerDependencies(manifest, result);
    }
    if (manifest.configSchema) {
      this.validateConfigSchema(manifest, result);
    }
    if (manifest.license) {
      this.validateLicense(manifest, result);
    }
    if (manifest.rules) {
      this.validateRuleSet(manifest, result);
    }

    return result;
  }

  private static validateId(manifest: any, result: ManifestValidationResult): void {
    const id = manifest.id;

    // Check format: lowercase, hyphens, alphanumeric
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(id)) {
      result.errors.push({
        field: 'id',
        error:
          'Plugin ID must be lowercase alphanumeric with hyphens ' +
          '(e.g., "my-plugin")',
        severity: 'error',
      });
      result.valid = false;
    }

    // Check length
    if (id.length < 3 || id.length > 50) {
      result.errors.push({
        field: 'id',
        error: 'Plugin ID must be between 3 and 50 characters',
        severity: 'error',
      });
      result.valid = false;
    }
  }

  private static validateVersion(manifest: any, result: ManifestValidationResult): void {
    const version = manifest.version;

    // Check semantic version format
    if (!/^\d+\.\d+\.\d+/.test(version)) {
      result.errors.push({
        field: 'version',
        error: 'Version must follow semantic versioning (e.g., "1.0.0")',
        severity: 'error',
      });
      result.valid = false;
    }
  }

  private static validateLanguages(manifest: any, result: ManifestValidationResult): void {
    const languages = manifest.languages;

    if (!Array.isArray(languages) || languages.length === 0) {
      result.errors.push({
        field: 'languages',
        error: 'At least one language must be specified',
        severity: 'error',
      });
      result.valid = false;
    }

    const validLanguages = [
      'solidity',
      'rust',
      'vyper',
      'python',
      'javascript',
      'typescript',
    ];

    for (const lang of languages) {
      if (!validLanguages.includes(lang)) {
        result.warnings.push({
          field: 'languages',
          error: `Unknown language: ${lang}`,
          severity: 'warning',
        });
      }
    }
  }

  private static validateCapabilities(
    manifest: any,
    result: ManifestValidationResult,
  ): void {
    const capabilities = manifest.capabilities;

    if (!Array.isArray(capabilities) || capabilities.length === 0) {
      result.errors.push({
        field: 'capabilities',
        error: 'At least one capability must be specified',
        severity: 'error',
      });
      result.valid = false;
    }

    const validCapabilities = [
      'gas-optimization',
      'security-analysis',
      'code-quality',
      'performance',
      'compatibility',
      'custom',
    ];

    for (const cap of capabilities) {
      if (!validCapabilities.includes(cap)) {
        result.warnings.push({
          field: 'capabilities',
          error: `Unknown capability: ${cap}. Use 'custom' for custom capabilities`,
          severity: 'warning',
        });
      }
    }
  }

  private static validateVersionRange(
    manifest: any,
    result: ManifestValidationResult,
  ): void {
    const gasguardVersion = manifest.gasguardVersion;

    if (!gasguardVersion.min) {
      result.errors.push({
        field: 'gasguardVersion.min',
        error: 'Minimum version is required',
        severity: 'error',
      });
      result.valid = false;
    }

    if (gasguardVersion.max) {
      const min = gasguardVersion.min;
      const max = gasguardVersion.max;

      // Simple check: min should be <= max (basic comparison)
      if (min.localeCompare(max) > 0) {
        result.errors.push({
          field: 'gasguardVersion',
          error: 'Minimum version should not be greater than maximum version',
          severity: 'error',
        });
        result.valid = false;
      }
    }
  }

  private static validateContact(
    contact: any,
    fieldName: string,
    result: ManifestValidationResult,
  ): void {
    if (contact.email && !this.isValidEmail(contact.email)) {
      result.warnings.push({
        field: `${fieldName}.email`,
        error: 'Invalid email format',
        severity: 'warning',
      });
    }

    if (contact.url && !this.isValidUrl(contact.url)) {
      result.warnings.push({
        field: `${fieldName}.url`,
        error: 'Invalid URL format',
        severity: 'warning',
      });
    }
  }

  private static validateRepository(manifest: any, result: ManifestValidationResult): void {
    const repo = manifest.repository;

    if (repo.type && !['git', 'svn', 'hg', 'pijul'].includes(repo.type)) {
      result.warnings.push({
        field: 'repository.type',
        error: `Unknown repository type: ${repo.type}`,
        severity: 'warning',
      });
    }

    if (repo.url && !this.isValidUrl(repo.url)) {
      result.errors.push({
        field: 'repository.url',
        error: 'Invalid repository URL',
        severity: 'error',
      });
    }
  }

  private static validateDependencies(
    manifest: any,
    result: ManifestValidationResult,
  ): void {
    const deps = manifest.dependencies || {};

    for (const [depId, dep] of Object.entries(deps)) {
      if (!dep?.versionRange?.min) {
        result.errors.push({
          field: `dependencies.${depId}`,
          error: 'Dependency must specify versionRange.min',
          severity: 'error',
        });
        result.valid = false;
      }
    }
  }

  private static validatePeerDependencies(
    manifest: any,
    result: ManifestValidationResult,
  ): void {
    const peerDeps = manifest.peerDependencies || {};

    for (const [peerId, range] of Object.entries(peerDeps)) {
      if (!range?.min) {
        result.warnings.push({
          field: `peerDependencies.${peerId}`,
          error: 'Peer dependency should specify min version',
          severity: 'warning',
        });
      }
    }
  }

  private static validateConfigSchema(
    manifest: any,
    result: ManifestValidationResult,
  ): void {
    const schema = manifest.configSchema;

    if (schema && typeof schema !== 'object') {
      result.errors.push({
        field: 'configSchema',
        error: 'Config schema must be a valid JSON Schema object',
        severity: 'error',
      });
      result.valid = false;
    }

    if (manifest.defaultConfig && manifest.configSchema) {
      // Basic check: defaultConfig keys should be in configSchema
      const schemaKeys = Object.keys(manifest.configSchema.properties || {});
      for (const key of Object.keys(manifest.defaultConfig)) {
        if (!schemaKeys.includes(key) && !manifest.configSchema.additionalProperties) {
          result.warnings.push({
            field: 'defaultConfig',
            error: `Default config key '${key}' not found in configSchema`,
            severity: 'warning',
          });
        }
      }
    }
  }

  private static validateLicense(manifest: any, result: ManifestValidationResult): void {
    const license = manifest.license;

    // Common SPDX license identifiers
    const commonLicenses = ['MIT', 'Apache-2.0', 'GPL-3.0', 'BSD-3-Clause', 'ISC'];

    if (license && !commonLicenses.includes(license)) {
      result.warnings.push({
        field: 'license',
        error:
          `Unknown license: ${license}. ` +
          `Use SPDX license identifiers (https://spdx.org/licenses/)`,
        severity: 'warning',
      });
    }
  }

  private static validateRuleSet(manifest: any, result: ManifestValidationResult): void {
    const rules = manifest.rules;

    if (!Array.isArray(rules)) {
      result.errors.push({
        field: 'rules',
        error: 'rules must be an array when provided',
        severity: 'error',
      });
      result.valid = false;
      return;
    }

    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i] as PluginRuleDefinition;
      if (!rule.id || !rule.version || !rule.name || !rule.description) {
        result.errors.push({
          field: `rules[${i}]`,
          error: 'Each rule requires id, version, name, and description',
          severity: 'error',
        });
        result.valid = false;
      }

      if (rule.version && !/^\d+\.\d+\.\d+/.test(rule.version)) {
        result.errors.push({
          field: `rules[${i}].version`,
          error: 'Rule version must follow semantic versioning',
          severity: 'error',
        });
        result.valid = false;
      }
    }

    const optimized = optimizePluginRules(rules as PluginRuleDefinition[]);
    for (const removed of optimized.removedRules) {
      const msg =
        removed.reason === 'duplicate-id'
          ? `Duplicate rule '${removed.removedRuleId}' overlaps with '${removed.keptRuleId}'`
          : `Overlapping rule intent detected for '${removed.removedRuleId}' (merged into '${removed.keptRuleId}')`;

      result.warnings.push({
        field: 'rules',
        error: msg,
        severity: 'warning',
      });
    }
  }

  private static isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  private static isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Validates plugin compatibility with core and other plugins
 */
export class CompatibilityValidator {
  /**
   * Validate plugin compatibility with core
   */
  static validateCoreCompatibility(
    manifest: PluginManifest,
    coreVersion: string,
  ): CompatibilityCheckResult {
    return CompatibilityChecker.checkCoreCompatibility(
      manifest.version,
      coreVersion,
      manifest.gasguardVersion,
    );
  }

  /**
   * Validate all dependencies
   */
  static validateDependencies(
    manifest: PluginManifest,
    loadedPlugins: Map<string, string>,
  ): Map<string, CompatibilityCheckResult> {
    const results = new Map<string, CompatibilityCheckResult>();

    if (manifest.dependencies) {
      for (const [depId, dep] of Object.entries(manifest.dependencies)) {
        const depVersion = loadedPlugins.get(depId);

        if (!depVersion) {
          results.set(depId, {
            compatible: false,
            errors: [
              `Required dependency '${depId}' is not loaded or not found`,
            ],
            warnings: [],
          });
        } else {
          results.set(
            depId,
            CompatibilityChecker.checkDependencyCompatibility(
              depVersion,
              dep.versionRange,
            ),
          );
        }
      }
    }

    return results;
  }

  /**
   * Validate all peer dependencies
   */
  static validatePeerDependencies(
    manifest: PluginManifest,
    loadedPlugins: Map<string, string>,
  ): Map<string, CompatibilityCheckResult> {
    const results = new Map<string, CompatibilityCheckResult>();

    if (manifest.peerDependencies) {
      for (const [peerId, range] of Object.entries(manifest.peerDependencies)) {
        const peerVersion = loadedPlugins.get(peerId);

        if (!peerVersion) {
          results.set(peerId, {
            compatible: true, // Peer dependencies are optional
            errors: [],
            warnings: [
              `Peer dependency '${peerId}' is not loaded. Some features may not work.`,
            ],
          });
        } else {
          results.set(
            peerId,
            CompatibilityChecker.checkDependencyCompatibility(peerVersion, range),
          );
        }
      }
    }

    return results;
  }

  /**
   * Validate conflicts
   */
  static validateConflicts(
    manifest: PluginManifest,
    loadedPlugins: Map<string, string>,
  ): CompatibilityCheckResult {
    return CompatibilityChecker.checkConflicts(
      manifest.conflicts || [],
      loadedPlugins,
    );
  }

  /**
   * Full compatibility check
   */
  static fullCheck(
    manifest: PluginManifest,
    coreVersion: string,
    loadedPlugins: Map<string, string>,
  ): {
    coreCompatibility: CompatibilityCheckResult;
    dependencies: Map<string, CompatibilityCheckResult>;
    peerDependencies: Map<string, CompatibilityCheckResult>;
    conflicts: CompatibilityCheckResult;
    overallCompatible: boolean;
  } {
    const results = {
      coreCompatibility: this.validateCoreCompatibility(manifest, coreVersion),
      dependencies: this.validateDependencies(manifest, loadedPlugins),
      peerDependencies: this.validatePeerDependencies(manifest, loadedPlugins),
      conflicts: this.validateConflicts(manifest, loadedPlugins),
      overallCompatible: true,
    };

    // Check if overall compatible
    if (
      !results.coreCompatibility.compatible ||
      !results.conflicts.compatible ||
      Array.from(results.dependencies.values()).some((r) => !r.compatible)
    ) {
      results.overallCompatible = false;
    }

    return results;
  }
}
