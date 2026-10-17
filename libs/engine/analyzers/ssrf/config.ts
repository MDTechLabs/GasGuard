/**
 * Configuration surface for the SSRF analyzer (CWE-918).
 *
 * Options are read from `AnalyzerConfig.options.ssrf`.
 */

export const SSRF_OPTIONS_KEY = "ssrf";

export interface SsrfOptions {
  /**
   * Extra validator function names considered safe guards against SSRF.
   * Merged with {@link DEFAULT_SAFE_SSRF_VALIDATORS}.
   */
  safeValidators?: string[];
  /**
   * Extra HTTP request sinks as dotted call names (e.g. `"myClient.send"`).
   */
  additionalSinks?: string[];
  /**
   * Extra request-controlled input sources (e.g. `"event.queryStringParameters"`).
   */
  additionalSources?: string[];
  /**
   * How many lines around a request are searched for validation/sanitization guards.
   */
  proximityLines?: number;
  /** Files larger than this (UTF-8 bytes) are skipped with an error entry. */
  maxFileBytes?: number;
}

export interface ResolvedSsrfOptions {
  safeValidators: string[];
  additionalSinks: string[];
  additionalSources: string[];
  proximityLines: number;
  maxFileBytes: number;
}

export const DEFAULT_SAFE_SSRF_VALIDATORS: readonly string[] = [
  "validateUrlForSsrf",
  "preventSsrf",
  "isSafeUrl",
  "isPublicUrl",
  "isValidUrl",
  "validateWebhookUrl",
  "isSafeWebhook",
  "validateHost",
  "isAllowedHost",
  "isAllowedUrl",
  "isSafeDomain",
  "createSafeAgent",
  "createSsrfSafeAgent",
];

export const DEFAULT_PROXIMITY_LINES = 10;
export const MAX_PROXIMITY_LINES = 100;
export const DEFAULT_MAX_FILE_BYTES = 1024 * 1024; // 1 MB
export const MAX_MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

export const SUPPORTED_SSRF_EXTENSIONS: readonly string[] = [
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".py",
];

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const DOTTED_PATH = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+$/;

export function validateSsrfOptions(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return [`options.${SSRF_OPTIONS_KEY} must be an object`];
  }

  const errors: string[] = [];
  const opts = raw as Record<string, unknown>;

  const checkList = (key: string, pattern: RegExp, expected: string) => {
    const value = opts[key];
    if (value === undefined) return;
    if (!Array.isArray(value)) {
      errors.push(`options.${SSRF_OPTIONS_KEY}.${key} must be an array of strings`);
      return;
    }
    for (const item of value) {
      if (typeof item !== "string" || !pattern.test(item.trim())) {
        errors.push(
          `options.${SSRF_OPTIONS_KEY}.${key} entry ${JSON.stringify(item)} must be ${expected}`,
        );
      }
    }
  };

  checkList("safeValidators", IDENTIFIER, "an identifier");
  checkList("additionalSinks", DOTTED_PATH, "a dotted call name");
  checkList("additionalSources", DOTTED_PATH, "a dotted member path");

  const checkInt = (key: string, min: number, max: number) => {
    const value = opts[key];
    if (value === undefined) return;
    if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
      errors.push(
        `options.${SSRF_OPTIONS_KEY}.${key} must be an integer between ${min} and ${max}`,
      );
    }
  };

  checkInt("proximityLines", 1, MAX_PROXIMITY_LINES);
  checkInt("maxFileBytes", 1, MAX_MAX_FILE_BYTES);

  return errors;
}

export function resolveSsrfOptions(raw: SsrfOptions | undefined): ResolvedSsrfOptions {
  const opts = raw ?? {};
  return {
    safeValidators: Array.from(
      new Set([...DEFAULT_SAFE_SSRF_VALIDATORS, ...(opts.safeValidators ?? [])]),
    ),
    additionalSinks: [...(opts.additionalSinks ?? [])],
    additionalSources: [...(opts.additionalSources ?? [])],
    proximityLines: opts.proximityLines ?? DEFAULT_PROXIMITY_LINES,
    maxFileBytes: opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
  };
}

export function fileExtension(filePath: string): string {
  const base = filePath.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot).toLowerCase();
}

export function isDeclarationFile(filePath: string): boolean {
  return /\.d\.(?:ts|mts|cts)$/i.test(filePath);
}

export function isSupportedSsrfFile(filePath: string): boolean {
  return (
    SUPPORTED_SSRF_EXTENSIONS.includes(fileExtension(filePath)) &&
    !isDeclarationFile(filePath)
  );
}
