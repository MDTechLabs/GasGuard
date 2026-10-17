import { createHash } from "crypto";
import { Severity } from "./analyzer-interface";
import type { AnalysisResult, Finding } from "./analyzer-interface";

/**
 * Analyzer result normalization.
 *
 * Analyzers emit findings in slightly different shapes (path separators,
 * severity spellings, 0/1-based or missing lines, duplicate reports). This
 * module turns any analyzer output into one canonical, deterministic shape
 * before it crosses the worker/persistence/reporting boundary.
 *
 * Guarantees:
 *  - Pure and tenant-agnostic: no I/O, no clock, no shared state.
 *  - Never throws. Unusable input degrades to dropped findings plus
 *    `issues`, so one bad finding never fails the whole scan.
 *  - Same findings (in any order) always produce byte-identical output.
 *    Nondeterministic data (timings, memory) lives only under `telemetry`.
 */

export const NORMALIZATION_SCHEMA_VERSION = 1;
export const DEFAULT_MAX_MESSAGE_LENGTH = 2000;
export const DEFAULT_MAX_ISSUES = 100;

export type NormalizationIssueCode =
  | "MALFORMED_RESULT"
  | "MALFORMED_FINDING"
  | "MISSING_RULE_ID"
  | "INVALID_PATH"
  | "UNKNOWN_SEVERITY"
  | "INVALID_LINE"
  | "INVALID_COLUMN"
  | "EMPTY_MESSAGE"
  | "MESSAGE_TRUNCATED"
  | "INVALID_GAS_SAVINGS"
  | "DUPLICATE_FINDING";

export interface NormalizationIssue {
  code: NormalizationIssueCode;
  message: string;
  ruleId?: string;
  file?: string;
  /** True when the finding was removed from the output because of this issue. */
  dropped: boolean;
}

export interface NormalizationOptions {
  /** Severity used when a finding's severity is missing or unrecognised. Default: info. */
  fallbackSeverity?: Severity;
  /** Messages longer than this are truncated with an ellipsis. Default: 2000. */
  maxMessageLength?: number;
  /**
   * Absolute directory to strip from absolute finding paths (e.g. a checkout
   * dir). Absolute paths outside it are rejected so host paths never leak.
   */
  rootDir?: string;
  /** Cap on recorded issues (counts stay exact). Default: 100. */
  maxIssues?: number;
}

export interface NormalizedFinding {
  /** Stable identity: sha256 of rule, location and message (first 32 hex chars). */
  key: string;
  ruleId: string;
  message: string;
  severity: Severity;
  location: {
    file: string;
    startLine: number;
    endLine: number;
    startColumn?: number;
    endColumn?: number;
  };
  estimatedGasSavings?: number;
  suggestedFix?: Finding["suggestedFix"];
  metadata?: Record<string, unknown>;
}

export interface NormalizedAnalysisResult {
  schemaVersion: number;
  analyzerName?: string;
  analyzerVersion: string;
  filesAnalyzed: number;
  findings: NormalizedFinding[];
  summary: AnalysisResult["summary"];
  totalEstimatedGasSavings?: number;
  errors: Array<{ file: string; message: string }>;
  issues: NormalizationIssue[];
  counts: {
    received: number;
    normalized: number;
    dropped: number;
    duplicates: number;
    issues: number;
  };
  /** Run-dependent data, kept apart so the rest of the result stays deterministic. */
  telemetry: {
    analysisTimeMs?: number;
    memoryUsage?: AnalysisResult["memoryUsage"];
    incremental?: AnalysisResult["incremental"];
  };
}

const SEVERITY_RANK: Record<Severity, number> = {
  [Severity.CRITICAL]: 5,
  [Severity.HIGH]: 4,
  [Severity.MEDIUM]: 3,
  [Severity.LOW]: 2,
  [Severity.INFO]: 1,
};

const SEVERITY_ALIASES: Record<string, Severity> = {
  critical: Severity.CRITICAL,
  fatal: Severity.CRITICAL,
  high: Severity.HIGH,
  error: Severity.HIGH,
  medium: Severity.MEDIUM,
  moderate: Severity.MEDIUM,
  warning: Severity.MEDIUM,
  warn: Severity.MEDIUM,
  low: Severity.LOW,
  minor: Severity.LOW,
  info: Severity.INFO,
  informational: Severity.INFO,
  note: Severity.INFO,
  hint: Severity.INFO,
};

class IssueLog {
  readonly issues: NormalizationIssue[] = [];
  total = 0;
  constructor(private readonly max: number) {}
  add(issue: NormalizationIssue): void {
    this.total++;
    if (this.issues.length < this.max) this.issues.push(issue);
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Canonical repository-relative path: forward slashes, no `.`/empty segments,
 * `..` resolved. Returns undefined if the path is unusable or escapes the root.
 */
export function normalizeFindingPath(
  raw: unknown,
  rootDir?: string,
): string | undefined {
  if (typeof raw !== "string") return undefined;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return undefined;
  let p = raw.trim().replace(/\\/g, "/");
  if (p === "") return undefined;

  const isAbsolute = p.startsWith("/") || /^[A-Za-z]:\//.test(p);
  if (isAbsolute) {
    if (!rootDir) return undefined;
    const root = rootDir.replace(/\\/g, "/").replace(/\/+$/, "");
    if (p !== root && !p.startsWith(`${root}/`)) return undefined;
    p = p.slice(root.length);
  }

  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return undefined;
      out.pop();
    } else {
      out.push(seg);
    }
  }
  return out.length > 0 ? out.join("/") : undefined;
}

export function normalizeSeverity(raw: unknown): Severity | undefined {
  if (typeof raw !== "string") return undefined;
  return SEVERITY_ALIASES[raw.trim().toLowerCase()];
}

function toPositiveInt(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  const n = Math.floor(raw);
  return n >= 1 ? n : undefined;
}

/** Key-sorted, JSON-safe copy so metadata serialises identically every time. */
function canonicalize(value: unknown, depth = 0): unknown {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (depth > 8) return undefined;
  if (Array.isArray(value)) {
    return value.map((v) => {
      const c = canonicalize(v, depth + 1);
      return c === undefined ? null : c;
    });
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) {
      const c = canonicalize(value[k], depth + 1);
      if (c !== undefined) out[k] = c;
    }
    return out;
  }
  return undefined;
}

function findingKey(f: Omit<NormalizedFinding, "key">): string {
  const l = f.location;
  const material = [
    f.ruleId,
    l.file,
    l.startLine,
    l.startColumn ?? "",
    l.endLine,
    l.endColumn ?? "",
    f.message,
  ].join("\u0000");
  return createHash("sha256").update(material).digest("hex").slice(0, 32);
}

function normalizeFinding(
  raw: unknown,
  opts: Required<Pick<NormalizationOptions, "fallbackSeverity" | "maxMessageLength">> &
    Pick<NormalizationOptions, "rootDir">,
  log: IssueLog,
): NormalizedFinding | undefined {
  if (!isRecord(raw)) {
    log.add({ code: "MALFORMED_FINDING", message: "finding is not an object", dropped: true });
    return undefined;
  }

  const ruleId = typeof raw.ruleId === "string" ? raw.ruleId.trim() : "";
  if (ruleId === "") {
    log.add({ code: "MISSING_RULE_ID", message: "finding has no ruleId", dropped: true });
    return undefined;
  }

  // Legacy shapes: `location.line`, or flat `file`/`line` fields.
  const loc = isRecord(raw.location) ? raw.location : {};
  const rawFile = loc.file ?? raw.file ?? raw.filePath;
  const file = normalizeFindingPath(rawFile, opts.rootDir);
  if (file === undefined) {
    log.add({
      code: "INVALID_PATH",
      message: "finding path is missing, absolute, or escapes the repository root",
      ruleId,
      dropped: true,
    });
    return undefined;
  }

  let severity = normalizeSeverity(raw.severity);
  if (severity === undefined) {
    severity = opts.fallbackSeverity;
    log.add({
      code: "UNKNOWN_SEVERITY",
      message: `unrecognised severity, using ${severity}`,
      ruleId,
      file,
      dropped: false,
    });
  }

  let startLine = toPositiveInt(loc.startLine ?? loc.line ?? raw.line);
  if (startLine === undefined) {
    startLine = 1;
    log.add({ code: "INVALID_LINE", message: "invalid startLine, using 1", ruleId, file, dropped: false });
  }
  let endLine = toPositiveInt(loc.endLine);
  if (endLine === undefined || endLine < startLine) endLine = startLine;

  let startColumn = toPositiveInt(loc.startColumn);
  let endColumn = toPositiveInt(loc.endColumn);
  if ((loc.startColumn !== undefined && startColumn === undefined) ||
      (loc.endColumn !== undefined && endColumn === undefined)) {
    log.add({ code: "INVALID_COLUMN", message: "invalid column ignored", ruleId, file, dropped: false });
  }
  if (startColumn === undefined) endColumn = undefined;
  if (startColumn !== undefined && endColumn !== undefined && endLine === startLine && endColumn < startColumn) {
    endColumn = startColumn;
  }

  let message = typeof raw.message === "string"
    ? raw.message.replace(/\r\n?/g, "\n").trim()
    : "";
  if (message === "") {
    message = ruleId;
    log.add({ code: "EMPTY_MESSAGE", message: "empty message, using ruleId", ruleId, file, dropped: false });
  } else if (message.length > opts.maxMessageLength) {
    message = `${message.slice(0, opts.maxMessageLength - 1)}…`;
    log.add({ code: "MESSAGE_TRUNCATED", message: "message truncated", ruleId, file, dropped: false });
  }

  const location: NormalizedFinding["location"] = { file, startLine, endLine };
  if (startColumn !== undefined) location.startColumn = startColumn;
  if (endColumn !== undefined) location.endColumn = endColumn;

  const normalized: Omit<NormalizedFinding, "key"> = { ruleId, message, severity, location };

  if (raw.estimatedGasSavings !== undefined) {
    const g = raw.estimatedGasSavings;
    if (typeof g === "number" && Number.isFinite(g) && g >= 0) {
      normalized.estimatedGasSavings = g;
    } else {
      log.add({ code: "INVALID_GAS_SAVINGS", message: "invalid estimatedGasSavings removed", ruleId, file, dropped: false });
    }
  }
  if (isRecord(raw.suggestedFix) && typeof raw.suggestedFix.description === "string") {
    normalized.suggestedFix = canonicalize(raw.suggestedFix) as Finding["suggestedFix"];
  }
  if (isRecord(raw.metadata)) {
    const meta = canonicalize(raw.metadata) as Record<string, unknown>;
    if (Object.keys(meta).length > 0) normalized.metadata = meta;
  }

  return { key: findingKey(normalized), ...normalized };
}

function compareFindings(a: NormalizedFinding, b: NormalizedFinding): number {
  const cmp = (x: string | number, y: string | number) => (x < y ? -1 : x > y ? 1 : 0);
  return (
    cmp(a.location.file, b.location.file) ||
    cmp(a.location.startLine, b.location.startLine) ||
    cmp(a.location.startColumn ?? 0, b.location.startColumn ?? 0) ||
    cmp(a.ruleId, b.ruleId) ||
    cmp(SEVERITY_RANK[b.severity], SEVERITY_RANK[a.severity]) ||
    cmp(a.key, b.key)
  );
}

export function summarizeFindings(
  findings: ReadonlyArray<Pick<NormalizedFinding, "severity">>,
): AnalysisResult["summary"] {
  const summary = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) summary[f.severity]++;
  return summary;
}

export function normalizeFindings(
  rawFindings: unknown,
  options: NormalizationOptions = {},
): { findings: NormalizedFinding[]; issues: NormalizationIssue[]; counts: NormalizedAnalysisResult["counts"] } {
  const log = new IssueLog(options.maxIssues ?? DEFAULT_MAX_ISSUES);
  const opts = {
    fallbackSeverity: options.fallbackSeverity ?? Severity.INFO,
    maxMessageLength: options.maxMessageLength ?? DEFAULT_MAX_MESSAGE_LENGTH,
    rootDir: options.rootDir,
  };

  const list: unknown[] = Array.isArray(rawFindings) ? rawFindings : [];
  if (rawFindings !== undefined && !Array.isArray(rawFindings)) {
    log.add({ code: "MALFORMED_RESULT", message: "findings is not an array", dropped: true });
  }

  const normalized: NormalizedFinding[] = [];
  let dropped = 0;
  for (const raw of list) {
    const n = normalizeFinding(raw, opts, log);
    if (n) normalized.push(n);
    else dropped++;
  }

  // Sort before deduping so the surviving duplicate never depends on input order.
  normalized.sort(compareFindings);
  const seen = new Set<string>();
  const unique: NormalizedFinding[] = [];
  let duplicates = 0;
  for (const f of normalized) {
    if (seen.has(f.key)) {
      duplicates++;
      log.add({ code: "DUPLICATE_FINDING", message: "duplicate finding removed", ruleId: f.ruleId, file: f.location.file, dropped: true });
      continue;
    }
    seen.add(f.key);
    unique.push(f);
  }

  return {
    findings: unique,
    issues: log.issues,
    counts: {
      received: list.length,
      normalized: unique.length,
      dropped,
      duplicates,
      issues: log.total,
    },
  };
}

/**
 * Normalizes a full analyzer result. `analyzerName` is optional context that
 * is carried through verbatim.
 */
export function normalizeAnalysisResult(
  raw: unknown,
  options: NormalizationOptions & { analyzerName?: string } = {},
): NormalizedAnalysisResult {
  const record = isRecord(raw) ? raw : undefined;
  const { findings, issues, counts } = normalizeFindings(record?.findings, options);

  if (!record) {
    issues.unshift({ code: "MALFORMED_RESULT", message: "analyzer result is not an object", dropped: true });
    counts.issues++;
  }

  const errors: NormalizedAnalysisResult["errors"] = [];
  if (Array.isArray(record?.errors)) {
    for (const e of record!.errors as unknown[]) {
      if (!isRecord(e)) continue;
      const file = normalizeFindingPath(e.file, options.rootDir) ?? "<unknown>";
      const message = typeof e.message === "string" ? e.message.trim() : "unknown error";
      errors.push({ file, message });
    }
    errors.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.message < b.message ? -1 : a.message > b.message ? 1 : 0));
  }

  const gas = findings.reduce((sum, f) => sum + (f.estimatedGasSavings ?? 0), 0);
  const filesAnalyzed = record && typeof record.filesAnalyzed === "number" && Number.isFinite(record.filesAnalyzed) && record.filesAnalyzed >= 0
    ? Math.floor(record.filesAnalyzed)
    : 0;

  const result: NormalizedAnalysisResult = {
    schemaVersion: NORMALIZATION_SCHEMA_VERSION,
    analyzerVersion: typeof record?.analyzerVersion === "string" ? record.analyzerVersion : "unknown",
    filesAnalyzed,
    findings,
    summary: summarizeFindings(findings),
    errors,
    issues,
    counts,
    telemetry: {},
  };
  if (options.analyzerName !== undefined) result.analyzerName = options.analyzerName;
  if (gas > 0) result.totalEstimatedGasSavings = gas;

  if (record) {
    if (typeof record.analysisTime === "number") result.telemetry.analysisTimeMs = record.analysisTime;
    if (isRecord(record.memoryUsage)) result.telemetry.memoryUsage = record.memoryUsage as unknown as AnalysisResult["memoryUsage"];
    if (isRecord(record.incremental)) result.telemetry.incremental = record.incremental as unknown as AnalysisResult["incremental"];
  }
  return result;
}
