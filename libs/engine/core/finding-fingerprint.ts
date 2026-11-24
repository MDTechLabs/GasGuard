import { createHash } from "crypto";

/**
 * Deterministic finding fingerprints for tracking one issue across analysis runs and
 * refactors.
 *
 * The fingerprint is built from what identifies the issue, not from where it currently sits:
 *  - the rule id,
 *  - the enclosing contract / library / interface name and function name,
 *  - the flagged source, normalized so comment and whitespace edits do not change it.
 *
 * It deliberately excludes line and column numbers, the message text and, unless asked, the
 * file path. Adding lines above a finding, rewording its message, or moving the code into a
 * different file keeps the same fingerprint. Renaming the enclosing function or changing the
 * flagged code does not, because then it is a different finding as far as we can tell.
 *
 * Pure: no I/O, no clock, and it never throws on odd input.
 */

export const FINGERPRINT_VERSION = 1;

export interface FingerprintableFinding {
  ruleId: string;
  location: {
    file: string;
    startLine: number;
    endLine?: number;
  };
}

export interface FingerprintOptions {
  /** Include the file path in the identity. Off by default so moving code keeps its identity. */
  includePath?: boolean;
}

export interface FindingFingerprint {
  version: number;
  /** 32 hex characters: the first half of a SHA-256 digest. */
  value: string;
}

const CONTAINER_PATTERN = /^\s*(?:abstract\s+)?(contract|library|interface)\s+([A-Za-z_]\w*)/;
const FUNCTION_PATTERN = /^\s*function\s+([A-Za-z_]\w*)/;

/**
 * Strips comments and collapses whitespace. String literals are left alone, so a `//` inside
 * a string is also removed from the fingerprint material. That is an accepted imprecision.
 */
export function normalizeSource(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The nearest enclosing contract-like container and function for a 1-based line.
 * Lines up to and including `line` are considered, so a finding on a function header
 * resolves to that function.
 */
export function enclosingNames(
  code: string,
  line: number,
): { container: string | null; symbol: string | null } {
  let container: string | null = null;
  let symbol: string | null = null;
  if (typeof code !== "string" || !Number.isInteger(line) || line < 1) {
    return { container, symbol };
  }
  const lines = code.split(/\r?\n/);
  const limit = Math.min(line, lines.length);
  for (let i = 0; i < limit; i++) {
    const containerMatch = CONTAINER_PATTERN.exec(lines[i]);
    if (containerMatch) {
      container = containerMatch[2];
      symbol = null;
    }
    const functionMatch = FUNCTION_PATTERN.exec(lines[i]);
    if (functionMatch) {
      symbol = functionMatch[1];
    }
  }
  return { container, symbol };
}

/** The flagged source span, normalized. Empty when the span is outside the file. */
export function flaggedSource(code: string, startLine: number, endLine?: number): string {
  if (typeof code !== "string" || !Number.isInteger(startLine) || startLine < 1) return "";
  const start = startLine;
  const end = Math.max(start, Number.isInteger(endLine) ? (endLine as number) : start);
  const lines = code.split(/\r?\n/).slice(start - 1, end);
  return normalizeSource(lines.join("\n"));
}

export function computeFindingFingerprint(
  finding: FingerprintableFinding,
  code: string,
  options: FingerprintOptions = {},
): FindingFingerprint {
  const { startLine, endLine, file } = finding.location;
  const { container, symbol } = enclosingNames(code, startLine);
  const material = [
    `v${FINGERPRINT_VERSION}`,
    finding.ruleId,
    container ?? "",
    symbol ?? "",
    flaggedSource(code, startLine, endLine),
    options.includePath ? (file ?? "").replace(/\\/g, "/") : "",
  ].join("\u0000");
  return {
    version: FINGERPRINT_VERSION,
    value: createHash("sha256").update(material).digest("hex").slice(0, 32),
  };
}
