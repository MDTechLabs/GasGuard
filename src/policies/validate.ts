/**
 * Closed-schema validator for GasGuard policy documents.
 *
 * The document is rejected unless every field is known. Secure defaults are
 * applied only for omissions that would otherwise fail open (`mode`,
 * `gates.minSeverity`). Coercion is intentionally not performed: strings are
 * not parsed as numbers, and surrounding whitespace is not trimmed.
 */

import {
  NormalizedPolicy,
  POLICY_LIMITS,
  POLICY_MODES,
  POLICY_SCHEMA_VERSION,
  POLICY_SEVERITIES,
  PolicyIssue,
  PolicyMode,
  PolicySeverity,
  PolicyValidationResult,
  SECURE_DEFAULTS,
} from "./types";

const ROOT_KEYS = new Set([
  "schemaVersion",
  "name",
  "version",
  "description",
  "mode",
  "gates",
  "scope",
]);

const GATE_KEYS = new Set([
  "minSeverity",
  "ruleIds",
  "paths",
  "maxFindings",
  "maxFindingsBySeverity",
]);

const SCOPE_KEYS = new Set(["include", "exclude"]);

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

const NAME_RE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;
const VERSION_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/;
const RULE_ID_RE = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;

export function validatePolicy(raw: unknown): PolicyValidationResult {
  const errors: PolicyIssue[] = [];
  const warnings: PolicyIssue[] = [];
  const defaultsApplied: string[] = [];

  if (!isPlainObject(raw)) {
    errors.push(
      issue("(root)", "Policy must be a JSON object", "INVALID_ROOT_TYPE"),
    );
    return { valid: false, errors, warnings, defaultsApplied };
  }

  collectKeyProblems(raw, ROOT_KEYS, "(root)", errors);

  const schemaVersion = requireExact(
    raw.schemaVersion,
    POLICY_SCHEMA_VERSION,
    "schemaVersion",
    `schemaVersion must be the string "${POLICY_SCHEMA_VERSION}"`,
    "INVALID_SCHEMA_VERSION",
    errors,
  );

  const name = readName(raw.name, errors);
  const version = readVersion(raw.version, errors);
  const description = readDescription(raw.description, errors);
  const mode = readMode(raw.mode, errors, warnings, defaultsApplied);
  const gates = readGates(raw.gates, errors, warnings, defaultsApplied);
  const scope = readScope(raw.scope, errors, warnings);

  if (
    errors.length > 0 ||
    schemaVersion === undefined ||
    name === undefined ||
    version === undefined ||
    mode === undefined ||
    gates === undefined ||
    scope === undefined
  ) {
    return { valid: false, errors, warnings, defaultsApplied };
  }

  const policy: NormalizedPolicy = {
    schemaVersion,
    name,
    version,
    ...(description !== undefined ? { description } : {}),
    mode,
    gates,
    scope,
  };

  return { valid: true, errors, warnings, defaultsApplied, policy };
}

function readName(value: unknown, errors: PolicyIssue[]): string | undefined {
  if (typeof value !== "string" || !NAME_RE.test(value)) {
    errors.push(
      issue(
        "name",
        `name is required and must be 1-${POLICY_LIMITS.maxNameLength} characters of lowercase letters, digits, and hyphens, and must not start or end with a hyphen`,
        "INVALID_NAME",
      ),
    );
    return undefined;
  }
  return value;
}

function readVersion(
  value: unknown,
  errors: PolicyIssue[],
): string | undefined {
  if (typeof value !== "string" || !VERSION_RE.test(value)) {
    errors.push(
      issue(
        "version",
        'version is required and must be a semantic version (for example "1.0.0") without leading zeros',
        "INVALID_VERSION",
      ),
    );
    return undefined;
  }
  return value;
}

function readDescription(
  value: unknown,
  errors: PolicyIssue[],
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > POLICY_LIMITS.maxDescriptionLength ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)
  ) {
    errors.push(
      issue(
        "description",
        `description must be a string of 1-${POLICY_LIMITS.maxDescriptionLength} characters without control characters`,
        "INVALID_DESCRIPTION",
      ),
    );
    return undefined;
  }
  return value;
}

function readMode(
  value: unknown,
  errors: PolicyIssue[],
  warnings: PolicyIssue[],
  defaultsApplied: string[],
): PolicyMode | undefined {
  if (value === undefined) {
    defaultsApplied.push("mode");
    warnings.push(
      issue(
        "mode",
        `mode is omitted; defaulting to "${SECURE_DEFAULTS.mode}" so the policy fails closed`,
        "MISSING_MODE_DEFAULTED",
      ),
    );
    return SECURE_DEFAULTS.mode;
  }
  if (typeof value !== "string" || !isPolicyMode(value)) {
    errors.push(
      issue(
        "mode",
        `mode must be one of ${POLICY_MODES.map((mode) => `"${mode}"`).join(", ")}`,
        "INVALID_MODE",
      ),
    );
    return undefined;
  }
  if (value === "disabled") {
    warnings.push(
      issue(
        "mode",
        'mode is "disabled"; this policy will not fail a build',
        "POLICY_MODE_DISABLED",
      ),
    );
  }
  return value;
}

function readGates(
  value: unknown,
  errors: PolicyIssue[],
  warnings: PolicyIssue[],
  defaultsApplied: string[],
): NormalizedPolicy["gates"] | undefined {
  if (!isPlainObject(value)) {
    errors.push(issue("gates", '"gates" object is required', "MISSING_GATES"));
    return undefined;
  }

  collectKeyProblems(value, GATE_KEYS, "gates", errors);

  const minSeverity = readMinSeverity(
    value.minSeverity,
    errors,
    warnings,
    defaultsApplied,
  );
  const ruleIds = readRuleIds(value.ruleIds, errors);
  const paths = readPathList(value.paths, "gates.paths", errors, warnings);
  const maxFindings = readMaxFindings(value.maxFindings, errors);
  const maxFindingsBySeverity = readSeverityCaps(
    value.maxFindingsBySeverity,
    errors,
  );

  if (
    value.maxFindings === undefined &&
    (value.maxFindingsBySeverity === undefined ||
      (isPlainObject(value.maxFindingsBySeverity) &&
        Object.keys(value.maxFindingsBySeverity).length === 0))
  ) {
    warnings.push(
      issue(
        "gates.maxFindings",
        "no finding-count cap is set; only the severity gate will fail the build",
        "NO_FINDING_CAP",
      ),
    );
  }

  if (
    errors.some(
      (entry) => entry.path === "gates" || entry.path.startsWith("gates."),
    ) ||
    minSeverity === undefined ||
    ruleIds === undefined ||
    paths === undefined ||
    maxFindings === undefined ||
    maxFindingsBySeverity === undefined
  ) {
    return undefined;
  }

  const gates: NormalizedPolicy["gates"] = {
    minSeverity,
    ruleIds,
    paths,
    maxFindingsBySeverity,
  };
  if (typeof maxFindings === "number") {
    gates.maxFindings = maxFindings;
  }
  return gates;
}

function readMinSeverity(
  value: unknown,
  errors: PolicyIssue[],
  warnings: PolicyIssue[],
  defaultsApplied: string[],
): PolicySeverity | undefined {
  if (value === undefined) {
    defaultsApplied.push("gates.minSeverity");
    warnings.push(
      issue(
        "gates.minSeverity",
        `minSeverity is omitted; defaulting to "${SECURE_DEFAULTS.minSeverity}"`,
        "DEFAULT_MIN_SEVERITY",
      ),
    );
    return SECURE_DEFAULTS.minSeverity;
  }
  if (typeof value !== "string" || !isSeverity(value)) {
    errors.push(
      issue(
        "gates.minSeverity",
        `minSeverity must be one of ${POLICY_SEVERITIES.map((severity) => `"${severity}"`).join(", ")}`,
        "INVALID_MIN_SEVERITY",
      ),
    );
    return undefined;
  }
  if (value === "info") {
    warnings.push(
      issue(
        "gates.minSeverity",
        'minSeverity "info" fails the build on every reported finding',
        "NOISY_MIN_SEVERITY",
      ),
    );
  }
  return value;
}

function readRuleIds(
  value: unknown,
  errors: PolicyIssue[],
): string[] | undefined {
  if (value === undefined) {
    return [];
  }
  const items = readStringList(value, "gates.ruleIds", errors);
  if (items === undefined) {
    return undefined;
  }
  const seen = new Set<string>();
  for (const ruleId of items) {
    if (!RULE_ID_RE.test(ruleId)) {
      errors.push(
        issue(
          "gates.ruleIds",
          `rule id "${ruleId}" must start with a letter and contain only letters, digits, and . _ : -`,
          "INVALID_RULE_ID",
        ),
      );
      return undefined;
    }
    if (seen.has(ruleId)) {
      errors.push(
        issue(
          "gates.ruleIds",
          `duplicate rule id "${ruleId}"`,
          "DUPLICATE_RULE_ID",
        ),
      );
      return undefined;
    }
    seen.add(ruleId);
  }
  return items;
}

function readMaxFindings(
  value: unknown,
  errors: PolicyIssue[],
): number | undefined | "absent" {
  if (value === undefined) {
    return "absent";
  }
  if (!isBoundedInteger(value)) {
    errors.push(
      issue(
        "gates.maxFindings",
        `maxFindings must be an integer from 0 to ${POLICY_LIMITS.maxFindings}`,
        "INVALID_MAX_FINDINGS",
      ),
    );
    return undefined;
  }
  return value;
}

function readSeverityCaps(
  value: unknown,
  errors: PolicyIssue[],
): Partial<Record<PolicySeverity, number>> | undefined {
  if (value === undefined) {
    return {};
  }
  if (!isPlainObject(value)) {
    errors.push(
      issue(
        "gates.maxFindingsBySeverity",
        "maxFindingsBySeverity must be an object keyed by severity",
        "INVALID_SEVERITY_CAPS",
      ),
    );
    return undefined;
  }
  collectKeyProblems(
    value,
    new Set(POLICY_SEVERITIES),
    "gates.maxFindingsBySeverity",
    errors,
  );
  const caps: Partial<Record<PolicySeverity, number>> = {};
  for (const severity of POLICY_SEVERITIES) {
    if (value[severity] === undefined) {
      continue;
    }
    if (!isBoundedInteger(value[severity])) {
      errors.push(
        issue(
          `gates.maxFindingsBySeverity.${severity}`,
          `cap for "${severity}" must be an integer from 0 to ${POLICY_LIMITS.maxFindings}`,
          "INVALID_SEVERITY_CAP",
        ),
      );
      return undefined;
    }
    caps[severity] = value[severity] as number;
  }
  return caps;
}

function readScope(
  value: unknown,
  errors: PolicyIssue[],
  warnings: PolicyIssue[],
): NormalizedPolicy["scope"] | undefined {
  if (value === undefined) {
    return { include: [], exclude: [] };
  }
  if (!isPlainObject(value)) {
    errors.push(issue("scope", "scope must be an object", "INVALID_SCOPE"));
    return undefined;
  }
  collectKeyProblems(value, SCOPE_KEYS, "scope", errors);
  if (Object.keys(value).length === 0) {
    warnings.push(
      issue(
        "scope",
        "scope is empty; omit it or set include and exclude",
        "EMPTY_SCOPE",
      ),
    );
  }
  const include = readPathList(
    value.include,
    "scope.include",
    errors,
    warnings,
  );
  const exclude = readPathList(
    value.exclude,
    "scope.exclude",
    errors,
    warnings,
  );
  if (include === undefined || exclude === undefined) {
    return undefined;
  }
  return { include, exclude };
}

function readPathList(
  value: unknown,
  fieldPath: string,
  errors: PolicyIssue[],
  warnings: PolicyIssue[],
): string[] | undefined {
  if (value === undefined) {
    return [];
  }
  const items = readStringList(value, fieldPath, errors);
  if (items === undefined) {
    return undefined;
  }
  const seen = new Set<string>();
  for (const entry of items) {
    const problem = pathProblem(entry);
    if (problem !== null) {
      errors.push(
        issue(fieldPath, `path "${entry}" ${problem}`, "INVALID_PATH"),
      );
      return undefined;
    }
    if (seen.has(entry)) {
      warnings.push(
        issue(fieldPath, `duplicate path "${entry}"`, "DUPLICATE_PATH"),
      );
    }
    seen.add(entry);
  }
  return items;
}

function readStringList(
  value: unknown,
  fieldPath: string,
  errors: PolicyIssue[],
): string[] | undefined {
  if (!Array.isArray(value)) {
    errors.push(
      issue(
        fieldPath,
        `${fieldPath} must be an array of strings`,
        "INVALID_LIST",
      ),
    );
    return undefined;
  }
  if (value.length > POLICY_LIMITS.maxListLength) {
    errors.push(
      issue(
        fieldPath,
        `${fieldPath} may contain at most ${POLICY_LIMITS.maxListLength} entries`,
        "LIST_TOO_LONG",
      ),
    );
    return undefined;
  }
  for (const entry of value) {
    if (typeof entry !== "string") {
      errors.push(
        issue(
          fieldPath,
          `${fieldPath} must contain only strings`,
          "INVALID_LIST_ITEM",
        ),
      );
      return undefined;
    }
  }
  return value as string[];
}

function pathProblem(value: string): string | null {
  if (value.length === 0 || value.length > POLICY_LIMITS.maxPathLength) {
    return `must be 1-${POLICY_LIMITS.maxPathLength} characters`;
  }
  if (/[\u0000-\u001F\u007F]/.test(value)) {
    return "must not contain control characters";
  }
  if (value.includes("\\")) {
    return "must use forward slashes";
  }
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value)) {
    return "must be relative";
  }
  if (value.split("/").some((segment) => segment === "..")) {
    return "must not contain a parent-directory segment";
  }
  return null;
}

function collectKeyProblems(
  value: Record<string, unknown>,
  allowed: Set<string>,
  fieldPath: string,
  errors: PolicyIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      errors.push(
        issue(
          fieldPath === "(root)" ? key : `${fieldPath}.${key}`,
          `field "${key}" is not allowed`,
          "FORBIDDEN_FIELD",
        ),
      );
      continue;
    }
    if (!allowed.has(key)) {
      errors.push(
        issue(
          fieldPath === "(root)" ? key : `${fieldPath}.${key}`,
          `unknown field "${key}". Policy documents only allow declared fields`,
          "UNKNOWN_FIELD",
        ),
      );
    }
  }
}

function requireExact<T extends string>(
  value: unknown,
  expected: T,
  fieldPath: string,
  message: string,
  code: string,
  errors: PolicyIssue[],
): T | undefined {
  if (value !== expected) {
    errors.push(issue(fieldPath, message, code));
    return undefined;
  }
  return expected;
}

function isBoundedInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= POLICY_LIMITS.maxFindings
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPolicyMode(value: string): value is PolicyMode {
  return (POLICY_MODES as readonly string[]).includes(value);
}

function isSeverity(value: string): value is PolicySeverity {
  return (POLICY_SEVERITIES as readonly string[]).includes(value);
}

function issue(path: string, message: string, code: string): PolicyIssue {
  return { path, message, code };
}
