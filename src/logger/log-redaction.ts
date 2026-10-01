/**
 * Log Redaction
 *
 * Redacts sensitive values (secrets, keys, tokens, credentials) from log
 * messages and metadata **before** entries reach logging providers.
 *
 * Design goals:
 *  - Secure by default: redaction is ENABLED with conservative built-in patterns.
 *  - Modular: pure functions + a service wrapper; no provider coupling.
 *  - Backward compatible: optional fields on LoggerConfig; existing call sites
 *    continue to work unchanged.
 *
 * NOTE: This module never reports its own failures with entry content; error
 * reporting is intentionally generic to avoid creating a new leak vector.
 */

/** Marker written in place of redacted values. */
export const REDACTED_MARKER = '[REDACTED]';

/** Maximum recursion depth when walking nested metadata. */
const MAX_METADATA_DEPTH = 10;

/** Case-insensitive metadata key substrings that are always redacted. */
export const DEFAULT_REDACT_KEYS: readonly string[] = [
  'password',
  'passwd',
  'passphrase',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'authorization',
  'credential',
  'privatekey',
  'private-key',
  'private_key',
  'seed',
  'mnemonic',
  'sessionid',
  'session-id',
  'cookie',
  'set-cookie',
  'api-key',
  'apikey',
  'api_key',
  'bearer',
];

/**
 * Default regexes applied to messages and string values. Order matters:
 * specific token formats are matched before generic `key=value` assignments.
 */
export const DEFAULT_REDACT_VALUE_PATTERNS: readonly RegExp[] = [
  // Bearer / Basic / Token auth header schemes
  /(?:bearer|basic|token)\s+[a-z0-9\-._~+/]+=*/gi,
  // GitHub tokens (classic + fine-grained)
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
  // AWS access key ids
  /\bAKIA[0-9A-Z]{16}\b/g,
  // Slack tokens
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  // JWTs (three base64url segments)
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  // Hex-encoded private keys (64 hex chars, optionally 0x-prefixed)
  /\b(?:0x)?[0-9a-fA-F]{64}\b/g,
  // Stellar secret keys (S...). Public G... keys are intentionally NOT redacted.
  /\bS[A-Z2-7]{55}\b/g,
  // Generic `password=hunter2` / `apiKey: sk-123` style assignments
  /(?:password|passwd|secret|token|api[_-]?key|access[_-]?token|private[_-]?key|credential)\s*[=:]\s*\S+/gi,
];

/** Default behaviour for the redaction subsystem (secure by default). */
export const DEFAULT_REDACTION_CONFIG = {
  enabled: true,
  redactKeys: DEFAULT_REDACT_KEYS,
  redactValuePatterns: DEFAULT_REDACT_VALUE_PATTERNS,
  allowlist: [] as readonly string[],
};

/**
 * User-suppliable redaction configuration. All fields are optional and merge
 * over {@link DEFAULT_REDACTION_CONFIG} — secure defaults apply when omitted.
 */
export interface LogRedactionConfig {
  /** Master switch. Default: `true` (secure by default). */
  enabled?: boolean;
  /** Additional key substrings to redact (case-insensitive). */
  extraPatterns?: string[];
  /** Additional regexes applied to messages and string values. */
  customPatterns?: RegExp[];
  /** Keys that must never be redacted (case-insensitive); beats defaults and extraPatterns. */
  allowlist?: string[];
  /** Override the built-in key list entirely (advanced use). */
  redactKeys?: string[];
  /** Override the built-in value regex list entirely (advanced use). */
  redactValuePatterns?: RegExp[];
}

/** Copy constructor helpers — each service instance owns its pattern state. */
function copyKeyList(keys: readonly string[]): string[] {
  return [...keys];
}

function copyValuePatterns(patterns: readonly RegExp[]): RegExp[] {
  return patterns.map((re) => new RegExp(re.source, re.flags));
}

/** Strip the `g` flag so a shared regex never carries `lastIndex` across calls. */
function toSafeRegex(re: RegExp): RegExp {
  return new RegExp(re.source, re.flags.replace(/g/g, ''));
}

/** Case-insensitive key matching with allowlist precedence. */
function keyMatches(key: string, keyList: readonly string[], allowlist: readonly string[]): boolean {
  const lower = key.toLowerCase();
  if (allowlist.some((allowed) => lower.includes(allowed.toLowerCase()))) {
    return false;
  }
  return keyList.some((k) => lower.includes(k.toLowerCase()));
}

/** Apply value patterns to a string (messages and string metadata values). */
function applyValuePatterns(value: string, patterns: readonly RegExp[]): string {
  let out = value;
  for (const pattern of patterns) {
    out = out.replace(toSafeRegex(pattern), REDACTED_MARKER);
  }
  return out;
}

/**
 * Recursively redact metadata. Returns a new structure; the input is never
 * mutated. Handles nested objects, arrays, cycles, Errors, and depth limits.
 */
function redactValue(
  value: unknown,
  keyList: readonly string[],
  valuePatterns: readonly RegExp[],
  allowlist: readonly string[],
  depth: number,
  seen: WeakSet<object>
): unknown {
  if (depth > MAX_METADATA_DEPTH) {
    return { redacted: true, reason: 'max-depth-exceeded' };
  }

  if (value === null || value === undefined) return value;

  switch (typeof value) {
    case 'string':
      return applyValuePatterns(value, valuePatterns);
    case 'number':
    case 'boolean':
    case 'bigint':
      return value;
    case 'function':
    case 'symbol':
      return undefined;
    default:
      break;
  }

  if (value instanceof Date) return value;

  if (value instanceof Error) {
    return {
      name: value.name,
      message: applyValuePatterns(String(value.message), valuePatterns),
    };
  }

  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  try {
    if (Array.isArray(value)) {
      return value.map((item) =>
        redactValue(item, keyList, valuePatterns, allowlist, depth + 1, seen)
      );
    }

    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (keyMatches(key, keyList, allowlist)) {
        out[key] = REDACTED_MARKER;
      } else {
        out[key] = redactValue(child, keyList, valuePatterns, allowlist, depth + 1, seen);
      }
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

/**
 * Configurable redaction engine used by the logging pipeline. Instantiate with
 * no arguments for secure defaults, or supply {@link LogRedactionConfig} to
 * extend the built-in key/value patterns.
 */
export class LogRedactionService {
  private enabled: boolean;
  private keyList: string[];
  private valuePatterns: RegExp[];
  private allowlist: string[];

  constructor(config: LogRedactionConfig = {}) {
    this.enabled = config.enabled ?? DEFAULT_REDACTION_CONFIG.enabled;
    this.keyList = copyKeyList(config.redactKeys ?? DEFAULT_REDACTION_CONFIG.redactKeys);
    this.keyList.push(...(config.extraPatterns ?? []));
    this.valuePatterns = copyValuePatterns(
      config.redactValuePatterns ?? DEFAULT_REDACTION_CONFIG.redactValuePatterns
    );
    this.valuePatterns.push(...(config.customPatterns ?? []));
    this.allowlist = [...(config.allowlist ?? DEFAULT_REDACTION_CONFIG.allowlist)];
  }

  /** Whether redaction is currently active. */
  isEnabled(): boolean {
    return this.enabled;
  }

  /** Enable or disable redaction (e.g. verbose local debugging only). */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Extend key substrings and value regexes at runtime. */
  addPatterns({ keys = [], valuePatterns = [] }: { keys?: string[]; valuePatterns?: RegExp[] }): void {
    this.keyList.push(...keys);
    this.valuePatterns.push(...valuePatterns.map((re) => new RegExp(re.source, re.flags)));
  }

  /** Current effective configuration; patterns are copied for safety. */
  getConfig(): Required<Omit<LogRedactionConfig, 'extraPatterns' | 'customPatterns'>> {
    return {
      enabled: this.enabled,
      redactKeys: copyKeyList(this.keyList),
      redactValuePatterns: copyValuePatterns(this.valuePatterns),
      allowlist: [...this.allowlist],
    };
  }

  /**
   * True when the given metadata key is considered sensitive.
   * Exposed for testability and allowlist verification.
   */
  isSensitiveKey(key: string): boolean {
    return keyMatches(key, this.keyList, this.allowlist);
  }

  /**
   * Redact a free-form message string using value patterns only.
   */
  redactMessage(message: string): string {
    if (!this.enabled) return message;
    return applyValuePatterns(message, this.valuePatterns);
  }

  /**
   * Deep-redact a metadata object. Returns a new object; the input is not
   * mutated. Fails closed: on internal error, metadata is replaced with a
   * generic marker rather than risk leaking unverified content.
   */
  redactMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
    if (!this.enabled) return metadata;
    try {
      return redactValue(metadata, this.keyList, this.valuePatterns, this.allowlist, 0, new WeakSet()) as Record<
        string,
        unknown
      >;
    } catch {
      // Fail closed: never emit metadata we could not verify as clean.
      return { redacted: true, reason: 'redaction-error' };
    }
  }

  /**
   * Redact both the message and metadata of a log entry payload.
   */
  redact(entry: { message: string; metadata?: Record<string, unknown> }): {
    message: string;
    metadata?: Record<string, unknown>;
  } {
    return {
      message: this.redactMessage(entry.message),
      metadata: entry.metadata ? this.redactMetadata(entry.metadata) : undefined,
    };
  }
}
