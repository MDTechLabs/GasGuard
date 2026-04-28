/**
 * GasGuard Config Validation System (Issue #221)
 *
 * Central validation pipeline for user-provided config files.
 * All config loading MUST pass through `validateConfig` before use so that
 * malformed files are rejected loudly instead of breaking scans silently.
 *
 * Design goals:
 *  - Schema validation mirrors `ConfigurationFile` in config.types.ts exactly.
 *  - Every error carries a `path` (dot-notation), a human-readable `message`,
 *    and a machine-readable `code` so callers can handle errors programmatically.
 *  - Warnings surface non-fatal issues (e.g. missing optional fields) without
 *    blocking the run.
 *  - `validateConfigFile` is a convenience wrapper that reads, parses, and
 *    validates in one call.
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ValidationError {
  path: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  path: string;
  message: string;
  code: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

/** Minimal shape of a user-supplied config that this validator accepts. */
export interface GasGuardConfigFile {
  version: string;
  lastUpdated?: string;
  system: SystemConfig;
  rules: RuleConfig[];
  profiles?: ProfileConfig[];
}

export interface SystemConfig {
  version: string;
  environment: 'development' | 'staging' | 'production';
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    enableConsole: boolean;
    enableFile: boolean;
    enableAudit: boolean;
  };
  performance: {
    maxConcurrency: number;
    timeoutMs: number;
    enableParallelExecution: boolean;
  };
  security: {
    enableApiKeyValidation: boolean;
    enableRateLimiting: boolean;
    maxRequestsPerMinute: number;
  };
  features: {
    enableAutoFix: boolean;
    enableDetailedReporting: boolean;
    enableRealTimeMonitoring: boolean;
  };
}

export interface RuleConfig {
  id: string;
  version?: string;
  name: string;
  enabled: boolean;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category?: string;
  language?: string;
  description?: string;
  parameters?: Record<string, unknown>;
  dependencies?: string[];
  tags?: string[];
}

export interface ProfileConfig {
  name: string;
  description?: string;
  rules: Partial<RuleConfig>[];
  systemOverrides?: Partial<SystemConfig>;
}

/** Thrown when validation fails and the caller requests a hard stop. */
export class ConfigValidationError extends Error {
  constructor(
    public readonly errors: ValidationError[],
    public readonly warnings: ValidationWarning[],
  ) {
    const summary = errors.map((e) => `  [${e.code}] ${e.path}: ${e.message}`).join('\n');
    super(`Config validation failed with ${errors.length} error(s):\n${summary}`);
    this.name = 'ConfigValidationError';
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_ENVIRONMENTS = new Set(['development', 'staging', 'production']);
const VALID_LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'info']);
const VALID_CATEGORIES = new Set([
  'security', 'performance', 'gas-optimization', 'best-practices',
  'solidity', 'soroban', 'vyper', 'rust', 'general',
]);
const VALID_LANGUAGES = new Set(['solidity', 'rust', 'vyper', 'any']);
const SEM_VER_RE = /^\d+\.\d+\.\d+(-.*)?$/;
const RULE_ID_RE = /^[a-z0-9-]+$/;

// ---------------------------------------------------------------------------
// Core validator
// ---------------------------------------------------------------------------

/**
 * Validate an already-parsed config object.
 *
 * Returns a `ValidationResult` — never throws.  Call `assertValid` on the
 * result if you want the process to abort on errors.
 */
export function validateConfig(raw: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push({
      path: '(root)',
      message: 'Config must be a JSON object',
      code: 'INVALID_ROOT_TYPE',
    });
    return { valid: false, errors, warnings };
  }

  const config = raw as Record<string, unknown>;

  validateTopLevel(config, errors, warnings);
  validateSystem(config.system, errors, warnings);
  validateRules(config.rules, errors, warnings);
  if (config.profiles !== undefined) {
    validateProfiles(config.profiles, errors, warnings);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate a config file on disk.  Reads, parses, and validates in one call.
 * Throws `ConfigValidationError` if parsing or validation fails.
 */
export function validateConfigFile(filePath: string): GasGuardConfigFile {
  const absPath = path.resolve(filePath);

  if (!fs.existsSync(absPath)) {
    throw new ConfigValidationError(
      [{ path: '(file)', message: `Config file not found: ${absPath}`, code: 'FILE_NOT_FOUND' }],
      [],
    );
  }

  let raw: unknown;
  try {
    const content = fs.readFileSync(absPath, 'utf-8');
    raw = JSON.parse(content);
  } catch (err) {
    throw new ConfigValidationError(
      [{
        path: '(file)',
        message: `Failed to parse config file as JSON: ${(err as Error).message}`,
        code: 'INVALID_JSON',
      }],
      [],
    );
  }

  const result = validateConfig(raw);
  assertValid(result);

  return raw as GasGuardConfigFile;
}

/**
 * Throw `ConfigValidationError` if the result contains errors.
 * Warnings are preserved on the thrown error but do not block the run on
 * their own.
 */
export function assertValid(result: ValidationResult): asserts result is ValidationResult & { valid: true } {
  if (!result.valid) {
    throw new ConfigValidationError(result.errors, result.warnings);
  }
}

// ---------------------------------------------------------------------------
// Section validators
// ---------------------------------------------------------------------------

function validateTopLevel(
  config: Record<string, unknown>,
  errors: ValidationError[],
  warnings: ValidationWarning[],
): void {
  // version (required, semver)
  if (!config.version) {
    errors.push({ path: 'version', message: 'version is required', code: 'MISSING_VERSION' });
  } else if (typeof config.version !== 'string' || !SEM_VER_RE.test(config.version)) {
    errors.push({
      path: 'version',
      message: `version must be a semantic version string (e.g. "1.0.0"), got: ${JSON.stringify(config.version)}`,
      code: 'INVALID_VERSION_FORMAT',
    });
  }

  // lastUpdated (optional, but warn if missing)
  if (config.lastUpdated === undefined) {
    warnings.push({
      path: 'lastUpdated',
      message: 'lastUpdated is missing; consider setting it for traceability',
      code: 'MISSING_LAST_UPDATED',
    });
  } else if (typeof config.lastUpdated !== 'string' || isNaN(Date.parse(config.lastUpdated as string))) {
    warnings.push({
      path: 'lastUpdated',
      message: 'lastUpdated should be a valid ISO 8601 date-time string',
      code: 'INVALID_LAST_UPDATED_FORMAT',
    });
  }

  // system (required object)
  if (config.system === undefined) {
    errors.push({ path: 'system', message: '"system" section is required', code: 'MISSING_SYSTEM' });
  }

  // rules (required array)
  if (config.rules === undefined) {
    errors.push({ path: 'rules', message: '"rules" array is required', code: 'MISSING_RULES' });
  } else if (!Array.isArray(config.rules)) {
    errors.push({ path: 'rules', message: '"rules" must be an array', code: 'INVALID_RULES_TYPE' });
  }
}

function validateSystem(
  system: unknown,
  errors: ValidationError[],
  warnings: ValidationWarning[],
): void {
  if (system === null || typeof system !== 'object' || Array.isArray(system)) {
    errors.push({
      path: 'system',
      message: '"system" must be an object',
      code: 'INVALID_SYSTEM_TYPE',
    });
    return;
  }

  const s = system as Record<string, unknown>;

  // system.version
  if (!s.version || typeof s.version !== 'string') {
    errors.push({
      path: 'system.version',
      message: 'system.version is required and must be a string',
      code: 'MISSING_SYSTEM_VERSION',
    });
  }

  // system.environment
  if (!s.environment) {
    errors.push({
      path: 'system.environment',
      message: 'system.environment is required',
      code: 'MISSING_ENVIRONMENT',
    });
  } else if (!VALID_ENVIRONMENTS.has(s.environment as string)) {
    errors.push({
      path: 'system.environment',
      message: `system.environment must be one of: ${[...VALID_ENVIRONMENTS].join(', ')}; got "${s.environment}"`,
      code: 'INVALID_ENVIRONMENT',
    });
  }

  // system.logging
  validateLogging(s.logging, errors, warnings);

  // system.performance
  validatePerformance(s.performance, errors);

  // system.security
  validateSecurity(s.security, errors);

  // system.features
  validateFeatures(s.features, errors);
}

function validateLogging(
  logging: unknown,
  errors: ValidationError[],
  _warnings: ValidationWarning[],
): void {
  if (!logging || typeof logging !== 'object') {
    errors.push({
      path: 'system.logging',
      message: '"system.logging" section is required and must be an object',
      code: 'MISSING_LOGGING',
    });
    return;
  }

  const l = logging as Record<string, unknown>;

  if (!l.level) {
    errors.push({ path: 'system.logging.level', message: 'logging.level is required', code: 'MISSING_LOG_LEVEL' });
  } else if (!VALID_LOG_LEVELS.has(l.level as string)) {
    errors.push({
      path: 'system.logging.level',
      message: `logging.level must be one of: ${[...VALID_LOG_LEVELS].join(', ')}; got "${l.level}"`,
      code: 'INVALID_LOG_LEVEL',
    });
  }

  for (const flag of ['enableConsole', 'enableFile', 'enableAudit'] as const) {
    if (typeof l[flag] !== 'boolean') {
      errors.push({
        path: `system.logging.${flag}`,
        message: `logging.${flag} must be a boolean`,
        code: `INVALID_${flag.toUpperCase()}`,
      });
    }
  }
}

function validatePerformance(perf: unknown, errors: ValidationError[]): void {
  if (!perf || typeof perf !== 'object') {
    errors.push({
      path: 'system.performance',
      message: '"system.performance" section is required and must be an object',
      code: 'MISSING_PERFORMANCE',
    });
    return;
  }

  const p = perf as Record<string, unknown>;

  if (typeof p.maxConcurrency !== 'number' || !Number.isInteger(p.maxConcurrency) || p.maxConcurrency < 1 || p.maxConcurrency > 32) {
    errors.push({
      path: 'system.performance.maxConcurrency',
      message: 'performance.maxConcurrency must be an integer between 1 and 32',
      code: 'INVALID_MAX_CONCURRENCY',
    });
  }

  if (typeof p.timeoutMs !== 'number' || p.timeoutMs < 0) {
    errors.push({
      path: 'system.performance.timeoutMs',
      message: 'performance.timeoutMs must be a non-negative number',
      code: 'INVALID_TIMEOUT',
    });
  }

  if (typeof p.enableParallelExecution !== 'boolean') {
    errors.push({
      path: 'system.performance.enableParallelExecution',
      message: 'performance.enableParallelExecution must be a boolean',
      code: 'INVALID_PARALLEL_EXECUTION',
    });
  }
}

function validateSecurity(sec: unknown, errors: ValidationError[]): void {
  if (!sec || typeof sec !== 'object') {
    errors.push({
      path: 'system.security',
      message: '"system.security" section is required and must be an object',
      code: 'MISSING_SECURITY',
    });
    return;
  }

  const s = sec as Record<string, unknown>;

  for (const flag of ['enableApiKeyValidation', 'enableRateLimiting'] as const) {
    if (typeof s[flag] !== 'boolean') {
      errors.push({
        path: `system.security.${flag}`,
        message: `security.${flag} must be a boolean`,
        code: `INVALID_${flag.toUpperCase()}`,
      });
    }
  }

  if (typeof s.maxRequestsPerMinute !== 'number' || s.maxRequestsPerMinute < 1) {
    errors.push({
      path: 'system.security.maxRequestsPerMinute',
      message: 'security.maxRequestsPerMinute must be a positive number',
      code: 'INVALID_MAX_REQUESTS',
    });
  }
}

function validateFeatures(features: unknown, errors: ValidationError[]): void {
  if (!features || typeof features !== 'object') {
    errors.push({
      path: 'system.features',
      message: '"system.features" section is required and must be an object',
      code: 'MISSING_FEATURES',
    });
    return;
  }

  const f = features as Record<string, unknown>;

  for (const flag of ['enableAutoFix', 'enableDetailedReporting', 'enableRealTimeMonitoring'] as const) {
    if (typeof f[flag] !== 'boolean') {
      errors.push({
        path: `system.features.${flag}`,
        message: `features.${flag} must be a boolean`,
        code: `INVALID_${flag.toUpperCase()}`,
      });
    }
  }
}

function validateRules(
  rules: unknown,
  errors: ValidationError[],
  warnings: ValidationWarning[],
): void {
  if (!Array.isArray(rules)) return; // already caught above

  const seenIds = new Set<string>();

  rules.forEach((rule, idx) => {
    const p = `rules[${idx}]`;

    if (rule === null || typeof rule !== 'object') {
      errors.push({ path: p, message: 'Each rule must be an object', code: 'INVALID_RULE_TYPE' });
      return;
    }

    const r = rule as Record<string, unknown>;

    // id
    if (!r.id) {
      errors.push({ path: `${p}.id`, message: 'Rule id is required', code: 'MISSING_RULE_ID' });
    } else if (typeof r.id !== 'string' || !RULE_ID_RE.test(r.id as string)) {
      errors.push({
        path: `${p}.id`,
        message: `Rule id must be lowercase alphanumeric with hyphens only; got "${r.id}"`,
        code: 'INVALID_RULE_ID_FORMAT',
      });
    } else if (seenIds.has(r.id as string)) {
      errors.push({
        path: `${p}.id`,
        message: `Duplicate rule id "${r.id}"`,
        code: 'DUPLICATE_RULE_ID',
      });
    } else {
      seenIds.add(r.id as string);
    }

    // name
    if (!r.name || typeof r.name !== 'string') {
      errors.push({ path: `${p}.name`, message: 'Rule name is required and must be a string', code: 'MISSING_RULE_NAME' });
    }

    // enabled
    if (typeof r.enabled !== 'boolean') {
      errors.push({ path: `${p}.enabled`, message: 'Rule enabled must be a boolean', code: 'INVALID_ENABLED_FLAG' });
    }

    // severity
    if (!r.severity) {
      errors.push({ path: `${p}.severity`, message: 'Rule severity is required', code: 'MISSING_SEVERITY' });
    } else if (!VALID_SEVERITIES.has(r.severity as string)) {
      errors.push({
        path: `${p}.severity`,
        message: `Rule severity must be one of: ${[...VALID_SEVERITIES].join(', ')}; got "${r.severity}"`,
        code: 'INVALID_SEVERITY',
      });
    }

    // version (optional but warn if present and malformed)
    if (r.version !== undefined && (typeof r.version !== 'string' || !SEM_VER_RE.test(r.version as string))) {
      warnings.push({
        path: `${p}.version`,
        message: `Rule version should follow semantic versioning (e.g. "1.0.0"); got "${r.version}"`,
        code: 'INVALID_RULE_VERSION_FORMAT',
      });
    }

    // category (optional, warn on unknown)
    if (r.category === undefined) {
      warnings.push({ path: `${p}.category`, message: 'Rule category is recommended', code: 'MISSING_CATEGORY' });
    } else if (typeof r.category === 'string' && !VALID_CATEGORIES.has(r.category)) {
      warnings.push({
        path: `${p}.category`,
        message: `Unknown category "${r.category}". Known: ${[...VALID_CATEGORIES].join(', ')}`,
        code: 'UNKNOWN_CATEGORY',
      });
    }

    // language (optional, warn on unknown)
    if (r.language !== undefined && typeof r.language === 'string' && !VALID_LANGUAGES.has(r.language)) {
      warnings.push({
        path: `${p}.language`,
        message: `Unknown language "${r.language}". Known: ${[...VALID_LANGUAGES].join(', ')}`,
        code: 'UNKNOWN_LANGUAGE',
      });
    }

    // dependencies – self-reference check
    if (r.dependencies !== undefined) {
      if (!Array.isArray(r.dependencies)) {
        errors.push({ path: `${p}.dependencies`, message: 'Rule dependencies must be an array', code: 'INVALID_DEPENDENCIES_TYPE' });
      } else {
        (r.dependencies as unknown[]).forEach((dep, di) => {
          if (typeof dep !== 'string') {
            errors.push({
              path: `${p}.dependencies[${di}]`,
              message: 'Each dependency must be a string rule id',
              code: 'INVALID_DEPENDENCY_TYPE',
            });
          }
        });
        if (r.id && (r.dependencies as string[]).includes(r.id as string)) {
          errors.push({ path: `${p}.dependencies`, message: `Rule "${r.id}" cannot depend on itself`, code: 'SELF_DEPENDENCY' });
        }
      }
    }
  });
}

function validateProfiles(
  profiles: unknown,
  errors: ValidationError[],
  warnings: ValidationWarning[],
): void {
  if (!Array.isArray(profiles)) {
    errors.push({ path: 'profiles', message: '"profiles" must be an array', code: 'INVALID_PROFILES_TYPE' });
    return;
  }

  const seenNames = new Set<string>();

  profiles.forEach((profile, idx) => {
    const p = `profiles[${idx}]`;

    if (profile === null || typeof profile !== 'object') {
      errors.push({ path: p, message: 'Each profile must be an object', code: 'INVALID_PROFILE_TYPE' });
      return;
    }

    const pr = profile as Record<string, unknown>;

    if (!pr.name || typeof pr.name !== 'string') {
      errors.push({ path: `${p}.name`, message: 'Profile name is required and must be a string', code: 'MISSING_PROFILE_NAME' });
    } else if (seenNames.has(pr.name as string)) {
      errors.push({ path: `${p}.name`, message: `Duplicate profile name "${pr.name}"`, code: 'DUPLICATE_PROFILE_NAME' });
    } else {
      seenNames.add(pr.name as string);
    }

    if (!pr.description) {
      warnings.push({ path: `${p}.description`, message: 'Profile description is recommended', code: 'MISSING_PROFILE_DESCRIPTION' });
    }

    if (!Array.isArray(pr.rules)) {
      errors.push({ path: `${p}.rules`, message: 'Profile rules must be an array', code: 'INVALID_PROFILE_RULES' });
    }
  });
}
