/**
 * Loads project-level GasGuard configuration from a `.gasguardrc` file.
 *
 * Supports `.gasguardrc` (JSON or YAML), `.gasguardrc.json`, and
 * `.gasguardrc.yaml`/`.gasguardrc.yml`. Falls back to {@link DEFAULT_CONFIG}
 * when no config file is present, and merges any partial config over the
 * defaults so a file only needs to declare the fields it overrides.
 */

import * as fs from "fs";
import * as path from "path";

import {
  DEFAULT_CONFIG,
  GasGuardConfig,
  SeverityThreshold,
  VALID_SEVERITIES,
} from "./config.interface";

const CONFIG_FILENAMES = [
  ".gasguardrc",
  ".gasguardrc.json",
  ".gasguardrc.yaml",
  ".gasguardrc.yml",
];

/**
 * Resolve the effective config for a project rooted at `cwd`.
 */
export function loadConfig(cwd: string = process.cwd()): GasGuardConfig {
  for (const name of CONFIG_FILENAMES) {
    const filePath = path.join(cwd, name);
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf8");
      return mergeConfig(parseConfigContent(name, raw));
    }
  }
  return { ...DEFAULT_CONFIG };
}

/**
 * Parse raw config file contents based on the file name. `.gasguardrc` with no
 * extension is tried as JSON first, then as YAML.
 */
export function parseConfigContent(
  filename: string,
  raw: string,
): Partial<GasGuardConfig> {
  const isYaml = filename.endsWith(".yaml") || filename.endsWith(".yml");
  if (isYaml) {
    return parseSimpleYaml(raw);
  }
  try {
    return JSON.parse(raw) as Partial<GasGuardConfig>;
  } catch {
    return parseSimpleYaml(raw);
  }
}

/**
 * Merge a partial config over the defaults, dropping malformed values.
 */
export function mergeConfig(partial: Partial<GasGuardConfig>): GasGuardConfig {
  const severity = partial.severityThreshold;
  return {
    ignoreRules:
      toStringArray(partial.ignoreRules) ?? DEFAULT_CONFIG.ignoreRules,
    includePaths:
      toStringArray(partial.includePaths) ?? DEFAULT_CONFIG.includePaths,
    excludePaths:
      toStringArray(partial.excludePaths) ?? DEFAULT_CONFIG.excludePaths,
    severityThreshold: isValidSeverity(severity)
      ? severity
      : DEFAULT_CONFIG.severityThreshold,
  };
}

/**
 * True when `filePath` is covered by one of the config's `excludePaths`, so the
 * caller can skip it during AST parsing.
 */
export function isPathExcluded(
  filePath: string,
  config: GasGuardConfig,
): boolean {
  const normalized = normalize(filePath);
  return config.excludePaths.some((exclude) => {
    const pattern = normalize(exclude);
    if (pattern === "") {
      return false;
    }
    return (
      normalized === pattern ||
      normalized.startsWith(pattern.endsWith("/") ? pattern : `${pattern}/`) ||
      normalized.includes(`/${pattern}/`)
    );
  });
}

function normalize(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isValidSeverity(value: unknown): value is SeverityThreshold {
  return (
    typeof value === "string" &&
    VALID_SEVERITIES.includes(value as SeverityThreshold)
  );
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === "string");
}

/**
 * Minimal YAML reader for the flat `.gasguardrc` shape: top-level
 * `key: value` scalars and `key:` followed by `  - item` string lists. This
 * avoids taking on a YAML dependency for a deliberately small config schema.
 */
export function parseSimpleYaml(raw: string): Partial<GasGuardConfig> {
  const result: Record<string, unknown> = {};
  const lines = raw.split(/\r?\n/);

  let currentKey: string | null = null;
  let currentArray: string[] | null = null;

  const commitArray = (): void => {
    if (currentKey !== null && currentArray !== null) {
      result[currentKey] = currentArray;
    }
    currentArray = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, "").replace(/\s+$/, "");
    if (line.trim() === "") {
      continue;
    }

    const listMatch = /^\s*-\s+(.*)$/.exec(line);
    if (listMatch !== null && currentKey !== null) {
      if (currentArray === null) {
        currentArray = [];
      }
      currentArray.push(stripQuotes(listMatch[1].trim()));
      continue;
    }

    const kvMatch = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (kvMatch !== null) {
      commitArray();
      const key = kvMatch[1];
      const value = kvMatch[2].trim();
      currentKey = key;
      if (value === "") {
        currentArray = [];
      } else {
        result[key] = stripQuotes(value);
        currentArray = null;
      }
    }
  }
  commitArray();

  return result as Partial<GasGuardConfig>;
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}
