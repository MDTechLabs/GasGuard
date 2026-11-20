/**
 * Malware-safe handling of repository-provided configuration files (#1348).
 *
 * Configuration from an untrusted repository is treated as inert data: only
 * JSON files are parsed, never loaded or evaluated. Executable config formats
 * (e.g. `hardhat.config.js`) are refused, input size and nesting depth are
 * bounded, and prototype-polluting keys are rejected.
 */

export class UnsafeRepositoryConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeRepositoryConfigError";
  }
}

export interface RepoConfigLimits {
  maxBytes: number;
  maxDepth: number;
}

export const DEFAULT_REPO_CONFIG_LIMITS: RepoConfigLimits = { maxBytes: 256 * 1024, maxDepth: 16 };

const EXECUTABLE_CONFIG = /\.(?:[cm]?[jt]sx?|sh|bash|py|rb|ps1|bat|cmd)$/i;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** True for config files that would have to be executed to be read. */
export function isExecutableConfigFile(fileName: string): boolean {
  return EXECUTABLE_CONFIG.test(fileName);
}

/** Parse a repository-provided JSON config without ever executing it. */
export function parseRepositoryConfig(
  fileName: string,
  text: string,
  limits: Partial<RepoConfigLimits> = {},
): unknown {
  const cfg = { ...DEFAULT_REPO_CONFIG_LIMITS, ...limits };
  if (isExecutableConfigFile(fileName)) {
    throw new UnsafeRepositoryConfigError(`executable config files are never loaded: ${fileName}`);
  }
  if (Buffer.byteLength(text, "utf8") > cfg.maxBytes) {
    throw new UnsafeRepositoryConfigError(`config exceeds ${cfg.maxBytes} bytes: ${fileName}`);
  }
  if (text.includes("\u0000")) {
    throw new UnsafeRepositoryConfigError(`config contains null bytes: ${fileName}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new UnsafeRepositoryConfigError(`config is not valid JSON: ${fileName}`);
  }

  const walk = (value: unknown, depth: number): void => {
    if (depth > cfg.maxDepth) {
      throw new UnsafeRepositoryConfigError(`config nesting exceeds ${cfg.maxDepth}: ${fileName}`);
    }
    if (value && typeof value === "object") {
      for (const key of Object.keys(value)) {
        if (FORBIDDEN_KEYS.has(key)) {
          throw new UnsafeRepositoryConfigError(`forbidden config key "${key}": ${fileName}`);
        }
        walk((value as Record<string, unknown>)[key], depth + 1);
      }
    }
  };
  walk(parsed, 1);
  return parsed;
}
