/**
 * AST parser fallback strategy.
 *
 * Analyzers that need a syntax tree should not lose a whole file because the
 * preferred parser rejects it (new syntax, a half-edited file, a parser bug or
 * a timeout). This module runs an ordered chain of parser strategies per file
 * and returns the best tree it can get, together with a record of what was
 * tried, so degraded results are visible rather than silent.
 *
 * Selection
 * ─────────
 * Strategies for a file's language run in order (most faithful first):
 * 1. The first strategy that returns a *complete* tree wins. It is `parsed` if
 *    it was the first strategy tried and `degraded` if an earlier one failed.
 * 2. A strategy that returns a *partial* tree (`complete: false`, e.g. a
 *    recovering parser or the lexical outline) is remembered, and the chain
 *    continues in case a later strategy completes.
 * 3. When no strategy completes, the earliest partial tree is returned as
 *    `degraded`, unless `requireComplete` is set, in which case the file is
 *    `failed`.
 * 4. Files no strategy supports are `unsupported`, never an empty success.
 *
 * Design
 * ──────
 * - No module state: strategies are passed in, so each tenant or job can use
 *   its own chain. Files are processed in path order.
 * - Deterministic: output depends only on sources, strategies and options.
 *   Wall-clock data lives in `telemetry`. A timeout is the one outcome that
 *   depends on machine speed; it is recorded as such in the attempts.
 * - Failure isolation: a throwing, hanging or malformed strategy affects only
 *   its own attempt. Nothing in this module throws for bad input.
 * - Retries: parsers are deterministic, so a failure moves on to the next
 *   strategy. Only errors flagged transient (`TransientParserError` or
 *   `error.transient === true`) are retried, up to `maxAttemptsPerStrategy`.
 *   A synchronous parser cannot be interrupted; on timeout its result is
 *   discarded and the chain continues.
 * - Privacy: parser messages are truncated and diagnostics are reduced to
 *   code/line/column/message, so file content is not copied into results.
 */

import { maskSource, type CrossFileLanguage } from "./cross-file-resolver";
import { normalizeFindingPath } from "./result-normalizer";

// ─── Public types ─────────────────────────────────────────────────────────────

export const PARSER_FALLBACK_SCHEMA_VERSION = 1;
export const DEFAULT_PARSE_TIMEOUT_MS = 5000;
export const DEFAULT_MAX_ATTEMPTS_PER_STRATEGY = 2;
export const DEFAULT_MAX_PARSE_FILE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MAX_DIAGNOSTICS_PER_FILE = 50;
const MAX_TEXT_LENGTH = 200;

export interface ParseDiagnostic {
  code: string;
  message: string;
  /** 1-based. */
  line: number;
  column?: number;
  /** Default `error`. */
  severity?: "error" | "warning";
}

export interface ParseContext {
  path: string;
  language: string;
}

export interface ParseOutput<TAst> {
  ast: TAst;
  /** False when the tree covers only part of the file. Default true. */
  complete?: boolean;
  diagnostics?: ParseDiagnostic[];
}

export interface ParserStrategy<TAst = unknown> {
  /** Unique, stable name; appears in results and in `strategyOrder`. */
  name: string;
  /** Languages handled, lower-case, or `"*"` for any. */
  languages: string[] | "*";
  /** Strategies are skipped for files larger than this. */
  maxBytes?: number;
  parse(source: string, context: ParseContext): ParseOutput<TAst> | Promise<ParseOutput<TAst>>;
}

/** Throw from a strategy for failures worth retrying (e.g. a busy worker). */
export class TransientParserError extends Error {
  readonly transient = true;
  constructor(message: string) {
    super(message);
    this.name = "TransientParserError";
  }
}

export interface ParserSource {
  path: string;
  content: string;
  /** Overrides detection from the file extension. */
  language?: string;
}

export interface ParserFallbackOptions {
  /** Per-attempt budget in ms. Default 5000. */
  timeoutMs?: number;
  /** Attempts per strategy for transient errors. Default 2. */
  maxAttemptsPerStrategy?: number;
  /** Files larger than this are `skipped`. Default 5 MiB. */
  maxFileBytes?: number;
  maxDiagnosticsPerFile?: number;
  /** When true, a file with only a partial tree is `failed`, not `degraded`. */
  requireComplete?: boolean;
  /** Per-language strategy order by name, overriding registration order. */
  strategyOrder?: Record<string, string[]>;
  disabledStrategies?: string[];
  /** Absolute root used to relativize absolute input paths. */
  rootDir?: string;
  languageOf?: (path: string) => string | undefined;
  now?: () => number;
}

export type AttemptOutcome =
  | "complete"
  | "partial"
  | "error"
  | "transient-error"
  | "timeout"
  | "skipped-size"
  | "invalid-output";

export interface ParseAttempt {
  strategy: string;
  attempt: number;
  outcome: AttemptOutcome;
  /** Truncated error text; never file content by design. */
  message?: string;
  diagnostics: number;
}

export type FileParseStatus = "parsed" | "degraded" | "failed" | "unsupported" | "skipped";

export interface FileParseResult<TAst> {
  path: string;
  language?: string;
  status: FileParseStatus;
  /** Strategy that produced `ast`. */
  strategy?: string;
  /** True when `ast` did not come from the first strategy tried. */
  fallbackUsed: boolean;
  /** Whether `ast` covers the whole file. */
  complete: boolean;
  ast?: TAst;
  diagnostics: ParseDiagnostic[];
  attempts: ParseAttempt[];
  /** Why the file is `failed`, `unsupported` or `skipped`. */
  reason?: string;
}

export type ParserFallbackIssueCode =
  | "INVALID_PATH"
  | "DUPLICATE_PATH"
  | "DUPLICATE_STRATEGY"
  | "UNKNOWN_STRATEGY"
  | "INVALID_CONFIG";

export interface ParserFallbackIssue {
  code: ParserFallbackIssueCode;
  message: string;
  file?: string;
}

export interface ParserFallbackResult<TAst> {
  schemaVersion: number;
  /** Sorted by path. */
  files: Array<FileParseResult<TAst>>;
  issues: ParserFallbackIssue[];
  summary: {
    files: number;
    parsed: number;
    degraded: number;
    failed: number;
    unsupported: number;
    skipped: number;
    /** Files whose tree came from a strategy other than the first tried. */
    fallbackUsed: number;
    /** Files whose attempts include a timeout (the machine-dependent outcome). */
    timedOut: number;
    byStrategy: Record<string, number>;
  };
  /** Run-dependent data, kept apart so the rest of the result stays deterministic. */
  telemetry: { elapsedMs: number };
}

// ─── Public API ───────────────────────────────────────────────────────────────

const EXTENSION_LANGUAGES: Record<string, string> = {
  ".sol": "solidity",
  ".rs": "rust",
  ".vy": "vyper",
  ".vyi": "vyper",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
};

export function detectLanguage(path: string): string | undefined {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? undefined : EXTENSION_LANGUAGES[base.slice(dot).toLowerCase()];
}

/**
 * Parses every source with the strategy chain for its language. Never throws.
 *
 * @param strategies Registered strategies. Registration order is the default
 *                   priority; `options.strategyOrder` can override it per language.
 */
export async function parseWithFallback<TAst = unknown>(
  sources: ParserSource[],
  strategies: Array<ParserStrategy<TAst>>,
  options: ParserFallbackOptions = {},
): Promise<ParserFallbackResult<TAst>> {
  const now = options.now ?? (() => Date.now());
  const started = now();
  const issues: ParserFallbackIssue[] = [];
  const settings = resolveSettings(options, issues);
  const registry = indexStrategies(strategies, settings.disabled, issues);
  const orderOverrides = validateOrder(options.strategyOrder, registry, issues);

  // Normalize, order and de-duplicate so input order never matters.
  const normalized: ParserSource[] = [];
  for (const src of sources) {
    const p = normalizeFindingPath(src?.path, options.rootDir);
    if (p === undefined || typeof src.content !== "string") {
      issues.push({
        code: "INVALID_PATH",
        message: `Source path is invalid or outside the repository root: ${JSON.stringify(src?.path)}`,
      });
      continue;
    }
    normalized.push({ ...src, path: p });
  }
  normalized.sort((a, b) => cmp(a.path, b.path) || cmp(a.content, b.content));

  const files: Array<FileParseResult<TAst>> = [];
  let previous: string | undefined;
  for (const src of normalized) {
    if (src.path === previous) {
      issues.push({
        code: "DUPLICATE_PATH",
        file: src.path,
        message: "Duplicate source path; keeping the first occurrence in content order.",
      });
      continue;
    }
    previous = src.path;
    files.push(await parseFile(src, registry, orderOverrides, settings));
  }

  issues.sort((a, b) => cmp(a.file ?? "", b.file ?? "") || cmp(a.code, b.code) || cmp(a.message, b.message));

  return {
    schemaVersion: PARSER_FALLBACK_SCHEMA_VERSION,
    files,
    issues,
    summary: summarize(files),
    telemetry: { elapsedMs: Math.max(0, now() - started) },
  };
}

// ─── Per-file chain ───────────────────────────────────────────────────────────

interface Settings {
  timeoutMs: number;
  maxAttempts: number;
  maxFileBytes: number;
  maxDiagnostics: number;
  requireComplete: boolean;
  disabled: Set<string>;
  languageOf: (path: string) => string | undefined;
}

async function parseFile<TAst>(
  src: ParserSource,
  registry: Map<string, ParserStrategy<TAst>>,
  orderOverrides: Map<string, string[]>,
  settings: Settings,
): Promise<FileParseResult<TAst>> {
  const language = (src.language ?? settings.languageOf(src.path))?.toLowerCase();
  const base = { path: src.path, ...(language ? { language } : {}), diagnostics: [] as ParseDiagnostic[] };
  const fail = (
    status: FileParseStatus,
    reason: string,
    attempts: ParseAttempt[] = [],
  ): FileParseResult<TAst> => ({ ...base, status, fallbackUsed: false, complete: false, attempts, reason });

  if (language === undefined) {
    return fail("unsupported", "Language could not be determined from the file path.");
  }
  if (src.content.length > settings.maxFileBytes) {
    return fail("skipped", `File exceeds maxFileBytes (${settings.maxFileBytes}).`);
  }

  const chain = chainFor(language, registry, orderOverrides);
  if (chain.length === 0) {
    return fail("unsupported", `No parser strategy supports "${language}".`);
  }

  const attempts: ParseAttempt[] = [];
  // The earliest partial tree wins: strategies are ordered most faithful first.
  let best: { strategy: string; output: ParseOutput<TAst> } | undefined;
  let firstTried: string | undefined;

  for (const strategy of chain) {
    if (strategy.maxBytes !== undefined && src.content.length > strategy.maxBytes) {
      attempts.push({ strategy: strategy.name, attempt: 0, outcome: "skipped-size", diagnostics: 0 });
      continue;
    }
    firstTried ??= strategy.name;

    for (let attempt = 1; attempt <= settings.maxAttempts; attempt++) {
      const run = await runWithTimeout(
        () => strategy.parse(src.content, { path: src.path, language }),
        settings.timeoutMs,
      );

      if (run.kind === "timeout") {
        attempts.push({
          strategy: strategy.name,
          attempt,
          outcome: "timeout",
          message: `No result within ${settings.timeoutMs}ms.`,
          diagnostics: 0,
        });
        break;
      }
      if (run.kind === "error") {
        const transient = isTransient(run.error);
        attempts.push({
          strategy: strategy.name,
          attempt,
          outcome: transient ? "transient-error" : "error",
          message: describeError(run.error),
          diagnostics: 0,
        });
        if (transient && attempt < settings.maxAttempts) continue;
        break;
      }

      const output = run.value;
      if (!isParseOutput(output)) {
        attempts.push({
          strategy: strategy.name,
          attempt,
          outcome: "invalid-output",
          message: "Strategy returned no `ast`.",
          diagnostics: 0,
        });
        break;
      }

      const diagnostics = sanitizeDiagnostics(output.diagnostics, settings.maxDiagnostics);
      const complete = output.complete !== false;
      attempts.push({
        strategy: strategy.name,
        attempt,
        outcome: complete ? "complete" : "partial",
        diagnostics: diagnostics.length,
      });

      const result: ParseOutput<TAst> = { ...output, diagnostics };
      if (complete) {
        return {
          ...base,
          status: strategy.name === firstTried ? "parsed" : "degraded",
          strategy: strategy.name,
          fallbackUsed: strategy.name !== firstTried,
          complete: true,
          ast: output.ast,
          diagnostics,
          attempts,
        };
      }
      best ??= { strategy: strategy.name, output: result };
      break;
    }
  }

  if (best && !settings.requireComplete) {
    return {
      ...base,
      status: "degraded",
      strategy: best.strategy,
      fallbackUsed: best.strategy !== firstTried,
      complete: false,
      ast: best.output.ast,
      diagnostics: best.output.diagnostics ?? [],
      attempts,
    };
  }
  return fail(
    "failed",
    best
      ? "Only a partial tree was available and requireComplete is set."
      : "Every parser strategy failed.",
    attempts,
  );
}

function chainFor<TAst>(
  language: string,
  registry: Map<string, ParserStrategy<TAst>>,
  orderOverrides: Map<string, string[]>,
): Array<ParserStrategy<TAst>> {
  const supports = (s: ParserStrategy<TAst>) =>
    s.languages === "*" || s.languages.map((l) => l.toLowerCase()).includes(language);
  const override = orderOverrides.get(language);
  if (override) {
    return override.map((name) => registry.get(name)!).filter((s) => s && supports(s));
  }
  return [...registry.values()].filter(supports);
}

// ─── Built-in lexical outline strategy ────────────────────────────────────────

export interface OutlineNode {
  kind: string;
  name: string;
  /** 1-based, inclusive. */
  startLine: number;
  endLine: number;
  /** 0 for file level, 1 for members of a container. */
  depth: number;
}

export interface OutlineAst {
  kind: "outline";
  language: string;
  nodes: OutlineNode[];
}

export interface LexicalOutlineOptions {
  /** Strategy name. Default `lexical-outline`. */
  name?: string;
  /** Default 20 MiB: this strategy is the last resort for large files. */
  maxBytes?: number;
}

const OUTLINE_LANGUAGES = ["solidity", "rust", "vyper"];

/**
 * A last-resort strategy that never fails on text input. It tokenizes just
 * enough (comments, strings, braces, indentation) to list declarations with
 * their line ranges. It always reports `complete: false`, so analyzers know
 * they are working from an outline and not a full syntax tree.
 */
export function createLexicalOutlineStrategy(
  options: LexicalOutlineOptions = {},
): ParserStrategy<OutlineAst> {
  return {
    name: options.name ?? "lexical-outline",
    languages: OUTLINE_LANGUAGES,
    maxBytes: options.maxBytes ?? 20 * 1024 * 1024,
    parse(source, context): ParseOutput<OutlineAst> {
      const language = context.language as CrossFileLanguage;
      const diagnostics: ParseDiagnostic[] = [
        {
          code: "lexical_outline",
          message: "Declarations were extracted lexically; the tree is not a full AST.",
          line: 1,
          severity: "warning",
        },
      ];
      const nodes =
        language === "vyper"
          ? outlineIndented(source)
          : outlineBraced(source, language, diagnostics);
      nodes.sort((a, b) => a.startLine - b.startLine || cmp(a.name, b.name));
      return { ast: { kind: "outline", language, nodes }, complete: false, diagnostics };
    },
  };
}

const BRACED_DECLS: Record<string, { top: RegExp; member: RegExp }> = {
  solidity: {
    top: /\b(contract|interface|library|struct|enum|error|event|function|modifier|type)\s+([A-Za-z_$][\w$]*)/g,
    member: /\b(function|modifier|event|error|struct|enum)\s+([A-Za-z_$][\w$]*)/g,
  },
  rust: {
    top: /\b(fn|struct|enum|trait|mod|type|const|static|union)\s+(?!fn\b)([A-Za-z_]\w*)/g,
    member: /\b(fn|const|type)\s+(?!fn\b)([A-Za-z_]\w*)/g,
  },
};

function outlineBraced(
  source: string,
  language: CrossFileLanguage,
  diagnostics: ParseDiagnostic[],
): OutlineNode[] {
  const masked = maskSource(source, language);
  const starts = [0];
  for (let i = 0; i < masked.length; i++) if (masked[i] === "\n") starts.push(i + 1);
  const lineOf = (offset: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  // One pass: depth at every offset and the matching close for every open brace.
  const depths = new Int32Array(masked.length);
  const closeOf = new Map<number, number>();
  const stack: number[] = [];
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i];
    if (c === "}") {
      const open = stack.pop();
      if (open === undefined) {
        diagnostics.push({ code: "unmatched_close_brace", message: "Closing brace without a matching open.", line: lineOf(i) });
      } else {
        closeOf.set(open, i);
      }
    }
    depths[i] = stack.length;
    if (c === "{") stack.push(i);
  }
  for (const open of stack) {
    diagnostics.push({ code: "unterminated_block", message: "Block is never closed.", line: lineOf(open) });
  }

  const nodes: OutlineNode[] = [];
  const decls = BRACED_DECLS[language]!;
  for (const [depthLimit, regex] of [[0, decls.top], [1, decls.member]] as const) {
    const re = new RegExp(regex.source, "g");
    for (let m = re.exec(masked); m; m = re.exec(masked)) {
      const depth = depths[m.index]!;
      if (depth !== depthLimit) continue;
      if (depthLimit === 1 && !isInsideContainer(masked, m.index, depths)) continue;
      const bodyEnd = findDeclarationEnd(masked, m.index + m[0].length, closeOf);
      nodes.push({
        kind: m[1]!,
        name: m[2]!,
        startLine: lineOf(m.index),
        endLine: lineOf(bodyEnd ?? masked.length - 1),
        depth: depthLimit,
      });
    }
  }
  return nodes;
}

/** A depth-1 match only counts when its enclosing block belongs to a container declaration. */
function isInsideContainer(masked: string, offset: number, depths: Int32Array): boolean {
  let open = offset;
  while (open > 0 && !(masked[open] === "{" && depths[open] === 0)) open--;
  const boundary = Math.max(masked.lastIndexOf("}", open), masked.lastIndexOf(";", open));
  return /\b(contract|interface|library|impl|trait|mod)\b/.test(masked.slice(boundary + 1, open));
}

/** Offset of the `}` closing the declaration's body, or of its `;` when it has none. */
function findDeclarationEnd(masked: string, from: number, closeOf: Map<number, number>): number | undefined {
  let parens = 0;
  for (let i = from; i < masked.length; i++) {
    const c = masked[i];
    if (c === "(" || c === "[") parens++;
    else if (c === ")" || c === "]") parens--;
    else if (parens <= 0 && c === ";") return i;
    else if (parens <= 0 && c === "{") return closeOf.get(i);
  }
  return undefined;
}

function outlineIndented(source: string): OutlineNode[] {
  const masked = maskSource(source, "vyper").split(/\r?\n/);
  const re = /^(def|struct|event|interface|flag|enum)\s+([A-Za-z_]\w*)/;
  const nodes: OutlineNode[] = [];
  const isBlank = (line: string) => line.trim() === "";
  for (let i = 0; i < masked.length; i++) {
    const m = re.exec(masked[i]!);
    if (!m) continue;
    let last = i;
    for (let j = i + 1; j < masked.length; j++) {
      const line = masked[j]!;
      if (isBlank(line)) continue;
      if (!/^\s/.test(line)) break;
      last = j;
    }
    nodes.push({ kind: m[1]!, name: m[2]!, startLine: i + 1, endLine: last + 1, depth: 0 });
  }
  return nodes;
}

// ─── Internals ────────────────────────────────────────────────────────────────

const TIMED_OUT = Symbol("timed-out");

type RunOutcome<T> =
  | { kind: "ok"; value: T }
  | { kind: "error"; error: unknown }
  | { kind: "timeout" };

async function runWithTimeout<T>(fn: () => T | Promise<T>, timeoutMs: number): Promise<RunOutcome<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
  });
  try {
    const value = await Promise.race([Promise.resolve().then(fn), timeout]);
    return value === TIMED_OUT ? { kind: "timeout" } : { kind: "ok", value: value as T };
  } catch (error) {
    return { kind: "error", error };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function resolveSettings(options: ParserFallbackOptions, issues: ParserFallbackIssue[]): Settings {
  const pick = (key: keyof ParserFallbackOptions, fallback: number, valid: (v: number) => boolean): number => {
    const value = options[key] as number | undefined;
    if (value === undefined) return fallback;
    if (typeof value === "number" && Number.isFinite(value) && valid(value)) return value;
    issues.push({
      code: "INVALID_CONFIG",
      message: `${key} is invalid (${JSON.stringify(value)}); using ${fallback}.`,
    });
    return fallback;
  };
  return {
    timeoutMs: pick("timeoutMs", DEFAULT_PARSE_TIMEOUT_MS, (v) => v > 0),
    maxAttempts: pick("maxAttemptsPerStrategy", DEFAULT_MAX_ATTEMPTS_PER_STRATEGY, (v) => Number.isInteger(v) && v >= 1),
    maxFileBytes: pick("maxFileBytes", DEFAULT_MAX_PARSE_FILE_BYTES, (v) => v > 0),
    maxDiagnostics: pick("maxDiagnosticsPerFile", DEFAULT_MAX_DIAGNOSTICS_PER_FILE, (v) => Number.isInteger(v) && v >= 0),
    requireComplete: options.requireComplete === true,
    disabled: new Set(options.disabledStrategies ?? []),
    languageOf: options.languageOf ?? detectLanguage,
  };
}

function indexStrategies<TAst>(
  strategies: Array<ParserStrategy<TAst>>,
  disabled: Set<string>,
  issues: ParserFallbackIssue[],
): Map<string, ParserStrategy<TAst>> {
  const registry = new Map<string, ParserStrategy<TAst>>();
  for (const strategy of strategies) {
    if (!strategy || typeof strategy.name !== "string" || strategy.name === "" || typeof strategy.parse !== "function") {
      issues.push({ code: "INVALID_CONFIG", message: "A strategy without a name and parse() was ignored." });
      continue;
    }
    if (registry.has(strategy.name)) {
      issues.push({
        code: "DUPLICATE_STRATEGY",
        message: `Strategy "${strategy.name}" is registered more than once; keeping the first.`,
      });
      continue;
    }
    if (!disabled.has(strategy.name)) registry.set(strategy.name, strategy);
  }
  return registry;
}

function validateOrder<TAst>(
  order: Record<string, string[]> | undefined,
  registry: Map<string, ParserStrategy<TAst>>,
  issues: ParserFallbackIssue[],
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [language, names] of Object.entries(order ?? {})) {
    const known: string[] = [];
    for (const name of names) {
      if (registry.has(name)) known.push(name);
      else {
        issues.push({
          code: "UNKNOWN_STRATEGY",
          message: `strategyOrder for "${language}" names "${name}", which is not registered or is disabled; ignored.`,
        });
      }
    }
    out.set(language.toLowerCase(), known);
  }
  return out;
}

function isParseOutput<TAst>(value: unknown): value is ParseOutput<TAst> {
  return typeof value === "object" && value !== null && (value as ParseOutput<TAst>).ast !== undefined;
}

function isTransient(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { transient?: unknown }).transient === true;
}

function describeError(error: unknown): string {
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : String(error);
  return truncate(`${name}: ${message.split("\n")[0]}`);
}

function truncate(text: string): string {
  return text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH - 1)}…` : text;
}

function sanitizeDiagnostics(raw: ParseDiagnostic[] | undefined, max: number): ParseDiagnostic[] {
  if (!Array.isArray(raw)) return [];
  const out: ParseDiagnostic[] = [];
  for (const d of raw) {
    if (out.length >= max) break;
    if (typeof d !== "object" || d === null) continue;
    out.push({
      code: typeof d.code === "string" && d.code.trim() !== "" ? d.code : "parser_diagnostic",
      message: truncate(typeof d.message === "string" ? d.message : ""),
      line: Number.isInteger(d.line) && d.line >= 1 ? d.line : 1,
      ...(Number.isInteger(d.column) && (d.column as number) >= 1 ? { column: d.column } : {}),
      ...(d.severity === "warning" ? { severity: "warning" as const } : {}),
    });
  }
  return out;
}

function summarize<TAst>(files: Array<FileParseResult<TAst>>): ParserFallbackResult<TAst>["summary"] {
  const byStrategy: Record<string, number> = {};
  const summary = {
    files: files.length,
    parsed: 0,
    degraded: 0,
    failed: 0,
    unsupported: 0,
    skipped: 0,
    fallbackUsed: 0,
    timedOut: 0,
    byStrategy,
  };
  for (const f of files) {
    summary[f.status]++;
    if (f.fallbackUsed) summary.fallbackUsed++;
    if (f.attempts.some((a) => a.outcome === "timeout")) summary.timedOut++;
    if (f.strategy) byStrategy[f.strategy] = (byStrategy[f.strategy] ?? 0) + 1;
  }
  summary.byStrategy = Object.fromEntries(Object.entries(byStrategy).sort((a, b) => cmp(a[0], b[0])));
  return summary;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
