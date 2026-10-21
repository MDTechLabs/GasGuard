/**
 * Cross-file reference resolution.
 *
 * Given an in-memory snapshot of a repository (path + content pairs), builds
 * the import graph, the table of top-level symbol definitions, and resolves
 * every use of an imported symbol back to the file and line that defines it.
 * Supported inputs: Solidity (`.sol`), Rust (`.rs`) and Vyper (`.vy`, `.vyi`).
 *
 * Design
 * ──────
 * - Pure and synchronous: no filesystem, network or clock access, so a call is
 *   idempotent and safe to retry, and results are byte-identical for the same
 *   sources and options regardless of input order.
 * - Tenant-safe: the resolver only sees the sources it is handed and keeps no
 *   module-level state. Paths are normalized to repository-relative form and
 *   anything that escapes the root is rejected.
 * - Unsupported input: files with an unknown extension are skipped and listed
 *   in `skippedFiles`; they never produce errors or silent "no reference"
 *   results.
 * - Partial failure: a file that cannot be processed produces a
 *   `ResolverIssue` and the rest of the repository is still resolved.
 * - Imports that point outside the snapshot (e.g. `@openzeppelin/...` with no
 *   remapping) are reported as `external`, not `unresolved`.
 */

import { normalizeFindingPath } from "./result-normalizer";

// ─── Public types ─────────────────────────────────────────────────────────────

export const CROSS_FILE_SCHEMA_VERSION = 1;
export const DEFAULT_MAX_FILES = 5000;
export const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;

export type CrossFileLanguage = "solidity" | "rust" | "vyper";

export interface CrossFileSource {
  /** Repository-relative path. Backslashes and `./` prefixes are normalized. */
  path: string;
  content: string;
}

export interface CrossFileResolverOptions {
  /**
   * Solidity import remappings, `prefix -> target` (the `remappings.txt` /
   * `foundry.toml` form). The longest matching prefix wins.
   */
  remappings?: Record<string, string>;
  /** Absolute root used to relativize absolute input paths. */
  rootDir?: string;
  /** Files beyond this count (after path sorting) are skipped. */
  maxFiles?: number;
  /** Files larger than this many UTF-16 code units are skipped. */
  maxFileBytes?: number;
}

export type SymbolKind =
  | "contract"
  | "interface"
  | "library"
  | "struct"
  | "enum"
  | "event"
  | "error"
  | "function"
  | "type"
  | "constant"
  | "trait"
  | "module";

export interface SymbolDefinition {
  name: string;
  kind: SymbolKind;
  file: string;
  line: number;
}

export type ImportStatus = "resolved" | "external" | "unresolved";

export interface ImportEdge {
  from: string;
  specifier: string;
  line: number;
  /** Imported symbol names; empty for whole-file / namespace / glob imports. */
  symbols: string[];
  /** Namespace alias (`import * as N`, `import a as N`, `mod n;`). */
  alias?: string;
  status: ImportStatus;
  resolvedPath?: string;
}

/** `external` means the symbol comes from an import outside the snapshot. */
export type ReferenceStatus = "resolved" | "ambiguous" | "unresolved" | "external";

export interface ResolvedReference {
  file: string;
  line: number;
  column: number;
  /** The symbol as written at the use site (the member name for `N.Member`). */
  name: string;
  /** Namespace alias used to reach the symbol, if any. */
  via?: string;
  status: ReferenceStatus;
  target?: SymbolDefinition;
  /** All candidate definitions when `status` is `ambiguous`. */
  candidates?: SymbolDefinition[];
}

export type ResolverIssueCode =
  | "INVALID_PATH"
  | "DUPLICATE_PATH"
  | "FILE_TOO_LARGE"
  | "TOO_MANY_FILES"
  | "UNSUPPORTED_LANGUAGE"
  | "UNRESOLVED_IMPORT"
  | "UNRESOLVED_SYMBOL"
  | "AMBIGUOUS_SYMBOL"
  | "IMPORT_CYCLE"
  | "PARSE_ERROR";

export interface ResolverIssue {
  code: ResolverIssueCode;
  message: string;
  file?: string;
  line?: number;
}

export interface CrossFileResolution {
  schemaVersion: number;
  /** Files that were parsed, sorted. */
  files: string[];
  /** Files skipped because of an unsupported language, sorted. */
  skippedFiles: string[];
  symbols: SymbolDefinition[];
  imports: ImportEdge[];
  references: ResolvedReference[];
  /** file -> sorted list of files it directly imports. */
  dependencies: Record<string, string[]>;
  /** Strongly connected import groups (size > 1, or self-import), sorted. */
  cycles: string[][];
  issues: ResolverIssue[];
  counts: {
    files: number;
    symbols: number;
    imports: number;
    references: number;
    unresolvedReferences: number;
    unresolvedImports: number;
  };
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface Binding {
  kind: "symbol" | "namespace";
  /** Target file; undefined when the import could not be resolved. */
  file?: string;
  /** The import points outside the snapshot (not an error). */
  external?: boolean;
  imported?: string;
  reexport: boolean;
}

interface Glob {
  file: string;
  reexport: boolean;
}

interface ParsedFile {
  path: string;
  language: CrossFileLanguage;
  /** Comments and string contents blanked; offsets and newlines preserved. */
  masked: string;
  /** Only comments blanked; import specifiers stay readable. */
  importText: string;
  defs: Map<string, SymbolDefinition>;
  bindings: Map<string, Binding>;
  globs: Glob[];
  /** Offset ranges of import statements, excluded from reference scanning. */
  importRanges: Array<[number, number]>;
}

const EXTENSIONS: Record<string, CrossFileLanguage> = {
  ".sol": "solidity",
  ".rs": "rust",
  ".vy": "vyper",
  ".vyi": "vyper",
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parses a `remappings.txt` body (`prefix=target` per line, `#` comments and
 * blank lines ignored; a `context:` prefix is dropped) into the map accepted
 * by `CrossFileResolverOptions.remappings`.
 */
export function parseRemappings(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    let prefix = line.slice(0, eq).trim();
    const colon = prefix.indexOf(":");
    if (colon >= 0) prefix = prefix.slice(colon + 1);
    if (prefix !== "") out[prefix] = line.slice(eq + 1).trim();
  }
  return out;
}

export function resolveCrossFileReferences(
  sources: CrossFileSource[],
  options: CrossFileResolverOptions = {},
): CrossFileResolution {
  const issues: ResolverIssue[] = [];
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;

  // 1. Normalize, de-duplicate and order the input so output never depends
  //    on the order the caller supplied it in.
  const normalized: CrossFileSource[] = [];
  for (const src of sources) {
    const p = normalizeFindingPath(src?.path, options.rootDir);
    if (p === undefined || typeof src.content !== "string") {
      issues.push({
        code: "INVALID_PATH",
        message: `Source path is invalid or outside the repository root: ${JSON.stringify(src?.path)}`,
      });
      continue;
    }
    normalized.push({ path: p, content: src.content });
  }
  normalized.sort((a, b) => cmp(a.path, b.path) || cmp(a.content, b.content));

  const unique: CrossFileSource[] = [];
  for (const src of normalized) {
    if (unique.length > 0 && unique[unique.length - 1]!.path === src.path) {
      issues.push({
        code: "DUPLICATE_PATH",
        file: src.path,
        message: `Duplicate source path; keeping the first occurrence in content order.`,
      });
      continue;
    }
    unique.push(src);
  }

  const parsed = new Map<string, ParsedFile>();
  const skippedFiles: string[] = [];
  const available = new Set(unique.map((s) => s.path));

  for (const src of unique) {
    const language = EXTENSIONS[extname(src.path)];
    if (!language) {
      skippedFiles.push(src.path);
      issues.push({
        code: "UNSUPPORTED_LANGUAGE",
        file: src.path,
        message: `No cross-file resolution support for "${extname(src.path) || src.path}"; file skipped.`,
      });
      continue;
    }
    if (src.content.length > maxFileBytes) {
      issues.push({
        code: "FILE_TOO_LARGE",
        file: src.path,
        message: `File exceeds maxFileBytes (${maxFileBytes}); file skipped.`,
      });
      continue;
    }
    if (parsed.size >= maxFiles) {
      issues.push({
        code: "TOO_MANY_FILES",
        file: src.path,
        message: `maxFiles (${maxFiles}) reached; file skipped.`,
      });
      continue;
    }
    try {
      parsed.set(src.path, parseDefinitions(src.path, language, src.content));
    } catch (err) {
      issues.push({
        code: "PARSE_ERROR",
        file: src.path,
        message: `Failed to parse file: ${String(err)}`,
      });
    }
  }

  // 2. Resolve imports (needs every file's definitions to exist first for
  //    bindings, but only the set of paths for locating targets).
  const importEdges: ImportEdge[] = [];
  const remappings = sortedRemappings(options.remappings);
  const parsedPaths = new Set(parsed.keys());
  for (const file of parsed.values()) {
    try {
      const raw = extractImports(file, parsedPaths, remappings, available);
      importEdges.push(...raw.edges);
      issues.push(...raw.issues);
    } catch (err) {
      issues.push({
        code: "PARSE_ERROR",
        file: file.path,
        message: `Failed to resolve imports: ${String(err)}`,
      });
    }
  }

  // 3. Resolve identifier uses against the bindings.
  const references: ResolvedReference[] = [];
  for (const file of parsed.values()) {
    try {
      references.push(...collectReferences(file, parsed, issues));
    } catch (err) {
      issues.push({
        code: "PARSE_ERROR",
        file: file.path,
        message: `Failed to resolve references: ${String(err)}`,
      });
    }
  }

  // 4. Graph-level output.
  const dependencies: Record<string, string[]> = {};
  for (const path of parsed.keys()) dependencies[path] = [];
  for (const edge of importEdges) {
    if (edge.resolvedPath !== undefined && dependencies[edge.from]) {
      dependencies[edge.from]!.push(edge.resolvedPath);
    }
  }
  for (const path of Object.keys(dependencies)) {
    dependencies[path] = [...new Set(dependencies[path])].sort(cmp);
  }

  const cycles = findCycles(dependencies);
  for (const cycle of cycles) {
    issues.push({
      code: "IMPORT_CYCLE",
      file: cycle[0],
      message: `Import cycle: ${[...cycle, cycle[0]].join(" -> ")}`,
    });
  }

  const symbols = [...parsed.values()]
    .flatMap((f) => [...f.defs.values()])
    .sort(compareDefs);
  importEdges.sort(
    (a, b) => cmp(a.from, b.from) || a.line - b.line || cmp(a.specifier, b.specifier),
  );
  references.sort(
    (a, b) =>
      cmp(a.file, b.file) || a.line - b.line || a.column - b.column || cmp(a.name, b.name),
  );
  issues.sort(
    (a, b) =>
      cmp(a.file ?? "", b.file ?? "") ||
      (a.line ?? 0) - (b.line ?? 0) ||
      cmp(a.code, b.code) ||
      cmp(a.message, b.message),
  );

  return {
    schemaVersion: CROSS_FILE_SCHEMA_VERSION,
    files: [...parsed.keys()].sort(cmp),
    skippedFiles: skippedFiles.sort(cmp),
    symbols,
    imports: importEdges,
    references,
    dependencies,
    cycles,
    issues,
    counts: {
      files: parsed.size,
      symbols: symbols.length,
      imports: importEdges.length,
      references: references.length,
      unresolvedReferences: references.filter((r) => r.status === "unresolved").length,
      unresolvedImports: importEdges.filter((e) => e.status === "unresolved").length,
    },
  };
}

/**
 * Returns every file whose analysis result can change when `changedFiles`
 * change: the changed files plus all of their transitive importers. Intended
 * to widen `AnalyzerConfig.changedFiles` for incremental runs.
 */
export function getAffectedFiles(
  resolution: CrossFileResolution,
  changedFiles: string[],
): string[] {
  const importers = new Map<string, string[]>();
  for (const [file, deps] of Object.entries(resolution.dependencies)) {
    for (const dep of deps) {
      if (!importers.has(dep)) importers.set(dep, []);
      importers.get(dep)!.push(file);
    }
  }
  const seen = new Set<string>();
  const queue: string[] = [];
  for (const raw of changedFiles) {
    const p = normalizeFindingPath(raw);
    if (p !== undefined && !seen.has(p)) {
      seen.add(p);
      queue.push(p);
    }
  }
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const importer of importers.get(current) ?? []) {
      if (!seen.has(importer)) {
        seen.add(importer);
        queue.push(importer);
      }
    }
  }
  return [...seen].sort(cmp);
}

/** All resolved references that point at the given definition. */
export function getReferencesTo(
  resolution: CrossFileResolution,
  file: string,
  name: string,
): ResolvedReference[] {
  return resolution.references.filter(
    (r) =>
      (r.target?.file === file && r.target.name === name) ||
      (r.candidates?.some((c) => c.file === file && c.name === name) ?? false),
  );
}

// ─── Text masking ─────────────────────────────────────────────────────────────

interface MaskSyntax {
  line: string;
  block: boolean;
  quotes: string;
  triple: boolean;
}

const SYNTAX: Record<CrossFileLanguage, MaskSyntax> = {
  solidity: { line: "//", block: true, quotes: "\"'", triple: false },
  // Single quotes are ambiguous in Rust (lifetimes), so only `"` is masked.
  rust: { line: "//", block: true, quotes: '"', triple: false },
  vyper: { line: "#", block: false, quotes: "\"'", triple: true },
};

/** Blanks comments (and optionally string contents), keeping offsets and newlines. */
function mask(text: string, language: CrossFileLanguage, keepStrings: boolean): string {
  const syn = SYNTAX[language];
  const out = text.split("");
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
  };
  let i = 0;
  while (i < text.length) {
    if (text.startsWith(syn.line, i)) {
      let end = text.indexOf("\n", i);
      if (end < 0) end = text.length;
      blank(i, end);
      i = end;
    } else if (syn.block && text.startsWith("/*", i)) {
      let end = text.indexOf("*/", i + 2);
      end = end < 0 ? text.length : end + 2;
      blank(i, end);
      i = end;
    } else if (syn.quotes.includes(text[i]!)) {
      const q = text[i]!;
      const triple = syn.triple && text.startsWith(q.repeat(3), i);
      const delim = triple ? q.repeat(3) : q;
      let j = i + delim.length;
      while (j < text.length) {
        if (text[j] === "\\") {
          j += 2;
          continue;
        }
        if (text.startsWith(delim, j)) break;
        if (!triple && text[j] === "\n") break;
        j++;
      }
      const closed = text.startsWith(delim, j);
      const innerEnd = closed ? j : Math.min(j, text.length);
      // Vyper triple-quoted strings are docstrings, so they are always blanked.
      if (triple) blank(i, closed ? j + delim.length : innerEnd);
      else if (!keepStrings) blank(i + delim.length, innerEnd);
      i = closed ? j + delim.length : innerEnd;
    } else {
      i++;
    }
  }
  return out.join("");
}

/**
 * Blanks comments and string contents for a supported language, keeping every
 * offset and newline. Shared with the lexical parser fallback.
 */
export function maskSource(text: string, language: CrossFileLanguage): string {
  return mask(text, language, false);
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

function positionOf(starts: number[], offset: number): { line: number; column: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - starts[lo]! + 1 };
}

function braceDepths(masked: string): Int32Array {
  const depths = new Int32Array(masked.length);
  let depth = 0;
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i];
    if (c === "}") depth = Math.max(0, depth - 1);
    depths[i] = depth;
    if (c === "{") depth++;
  }
  return depths;
}

// ─── Definition parsing ───────────────────────────────────────────────────────

function parseDefinitions(
  path: string,
  language: CrossFileLanguage,
  content: string,
): ParsedFile {
  const masked = mask(content, language, false);
  const starts = lineStarts(content);
  const defs = new Map<string, SymbolDefinition>();
  const add = (name: string, kind: SymbolKind, offset: number) => {
    if (!defs.has(name)) {
      defs.set(name, { name, kind, file: path, line: positionOf(starts, offset).line });
    }
  };

  if (language === "solidity") {
    const depths = braceDepths(masked);
    const re =
      /\b(contract|interface|library|struct|enum|event|error|function|type)\s+([A-Za-z_$][\w$]*)/g;
    for (let m = re.exec(masked); m; m = re.exec(masked)) {
      if (depths[m.index] !== 0) continue;
      add(m[2]!, m[1] === "type" ? "type" : (m[1] as SymbolKind), m.index + m[0].length - m[2]!.length);
    }
    const constRe = /\b(?:u?int\d*|bytes\d*|address|bool|string)\s+constant\s+([A-Za-z_$][\w$]*)/g;
    for (let m = constRe.exec(masked); m; m = constRe.exec(masked)) {
      if (depths[m.index] === 0) add(m[1]!, "constant", m.index + m[0].length - m[1]!.length);
    }
  } else if (language === "rust") {
    const depths = braceDepths(masked);
    const re = /\b(fn|struct|enum|trait|type|const|static|union)\s+(?!fn\b)([A-Za-z_]\w*)/g;
    const kinds: Record<string, SymbolKind> = {
      fn: "function",
      struct: "struct",
      enum: "enum",
      trait: "trait",
      type: "type",
      const: "constant",
      static: "constant",
      union: "struct",
    };
    for (let m = re.exec(masked); m; m = re.exec(masked)) {
      if (depths[m.index] !== 0) continue;
      add(m[2]!, kinds[m[1]!]!, m.index + m[0].length - m[2]!.length);
    }
  } else {
    const re = /^(def|struct|event|interface|flag|enum)\s+([A-Za-z_]\w*)/gm;
    const kinds: Record<string, SymbolKind> = {
      def: "function",
      struct: "struct",
      event: "event",
      interface: "interface",
      flag: "enum",
      enum: "enum",
    };
    for (let m = re.exec(masked); m; m = re.exec(masked)) {
      add(m[2]!, kinds[m[1]!]!, m.index + m[0].length - m[2]!.length);
    }
    const constRe = /^([A-Za-z_]\w*)\s*:\s*constant\s*\(/gm;
    for (let m = constRe.exec(masked); m; m = constRe.exec(masked)) {
      add(m[1]!, "constant", m.index);
    }
  }

  return {
    path,
    language,
    masked,
    importText: mask(content, language, true),
    defs,
    bindings: new Map(),
    globs: [],
    importRanges: [],
  };
}

// ─── Import extraction and path resolution ────────────────────────────────────

interface ExtractedImports {
  edges: ImportEdge[];
  issues: ResolverIssue[];
}

function extractImports(
  file: ParsedFile,
  parsed: Set<string>,
  remappings: Array<[string, string]>,
  available: Set<string>,
): ExtractedImports {
  const ctx: ImportContext = {
    file,
    parsed,
    remappings,
    available,
    edges: [],
    issues: [],
  };
  return file.language === "solidity"
    ? extractSolidity(ctx)
    : file.language === "rust"
      ? extractRust(ctx)
      : extractVyper(ctx);
}

interface ImportContext {
  file: ParsedFile;
  parsed: Set<string>;
  remappings: Array<[string, string]>;
  available: Set<string>;
  edges: ImportEdge[];
  issues: ResolverIssue[];
}

function recordEdge(
  ctx: ImportContext,
  edge: Omit<ImportEdge, "from">,
  offsets: [number, number],
  unresolvedMessage: string,
) {
  ctx.edges.push({ from: ctx.file.path, ...edge });
  ctx.file.importRanges.push(offsets);
  if (edge.status === "unresolved") {
    ctx.issues.push({
      code: "UNRESOLVED_IMPORT",
      file: ctx.file.path,
      line: edge.line,
      message: unresolvedMessage,
    });
  }
}

function addBinding(file: ParsedFile, local: string, binding: Binding) {
  if (!file.bindings.has(local)) file.bindings.set(local, binding);
}

// Solidity ─────────────────────────────────────────────────────────────────────

function extractSolidity(ctx: ImportContext): ExtractedImports {
  const { file } = ctx;
  const text = file.importText;
  const starts = lineStarts(text);
  const re =
    /\bimport\s+(?:(\*\s*as\s+([A-Za-z_$][\w$]*)|\{([^}]*)\})\s*from\s*)?(["'])([^"'\n]+)\4(?:\s*as\s+([A-Za-z_$][\w$]*))?\s*;/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const specifier = m[5]!;
    const line = positionOf(starts, m.index).line;
    const target = resolveSolidityPath(ctx, specifier);
    const status: ImportStatus =
      target.path !== undefined ? "resolved" : target.external ? "external" : "unresolved";
    const names = m[3] !== undefined ? parseSolidityNames(m[3]) : [];
    const alias = m[2] ?? m[6];

    recordEdge(
      ctx,
      {
        specifier,
        line,
        symbols: names.map((n) => n.imported),
        ...(alias ? { alias } : {}),
        status,
        ...(target.path !== undefined ? { resolvedPath: target.path } : {}),
      },
      [m.index, m.index + m[0].length],
      `Cannot resolve import "${specifier}".`,
    );

    const external = status === "external";
    if (m[3] !== undefined) {
      for (const n of names) {
        addBinding(file, n.local, {
          kind: "symbol",
          file: target.path,
          external,
          imported: n.imported,
          reexport: true,
        });
      }
    } else if (alias) {
      addBinding(file, alias, { kind: "namespace", file: target.path, external, reexport: false });
    } else if (target.path !== undefined) {
      file.globs.push({ file: target.path, reexport: true });
    }
  }
  return { edges: ctx.edges, issues: ctx.issues };
}

function parseSolidityNames(body: string): Array<{ imported: string; local: string }> {
  return body
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => {
      const [imported, local] = part.split(/\s+as\s+/);
      return { imported: imported!.trim(), local: (local ?? imported)!.trim() };
    });
}

function resolveSolidityPath(
  ctx: ImportContext,
  specifier: string,
): { path?: string; external?: boolean } {
  const dir = dirname(ctx.file.path);
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const p = joinPath(dir, specifier);
    return p !== undefined && ctx.parsed.has(p) ? { path: p } : {};
  }
  for (const [prefix, target] of ctx.remappings) {
    if (specifier.startsWith(prefix)) {
      const p = joinPath("", target + specifier.slice(prefix.length));
      if (p === undefined) return {};
      if (ctx.parsed.has(p)) return { path: p };
      // A target that is not in the snapshot at all (e.g. a vendored `lib/`
      // dependency) is external; one that was skipped is a real failure.
      return ctx.available.has(p) ? {} : { external: true };
    }
  }
  const direct = joinPath("", specifier);
  if (direct !== undefined && ctx.parsed.has(direct)) return { path: direct };
  if (direct !== undefined && ctx.available.has(direct)) return {};
  return { external: true };
}

// Rust ─────────────────────────────────────────────────────────────────────────

interface UseLeaf {
  path: string[];
  alias?: string;
  glob: boolean;
}

function extractRust(ctx: ImportContext): ExtractedImports {
  const { file } = ctx;
  const text = file.importText;
  const starts = lineStarts(text);
  const re =
    /(?:^|[;{}\s])(pub(?:\s*\([^)]*\))?\s+)?(use\s+([^;]+);|mod\s+([A-Za-z_]\w*)\s*;)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const reexport = m[1] !== undefined;
    const stmtStart = m.index + m[0].length - m[2]!.length - (m[1] ? m[1].length : 0);
    const range: [number, number] = [stmtStart, m.index + m[0].length];
    const line = positionOf(starts, stmtStart).line;

    if (m[4] !== undefined) {
      const name = m[4];
      const target = resolveRustModule(ctx, moduleDir(file.path), name);
      recordEdge(
        ctx,
        {
          specifier: name,
          line,
          symbols: [],
          alias: name,
          status: target ? "resolved" : "unresolved",
          ...(target ? { resolvedPath: target } : {}),
        },
        range,
        `Cannot find module file for "mod ${name};".`,
      );
      addBinding(file, name, { kind: "namespace", file: target, reexport });
      continue;
    }

    for (const leaf of expandRustUse(m[3]!.trim())) {
      const specifier = leaf.path.join("::") + (leaf.glob ? "::*" : "");
      const resolved = resolveRustUse(ctx, leaf.path);
      const status: ImportStatus = resolved.external
        ? "external"
        : resolved.moduleFile !== undefined || resolved.symbolFile !== undefined
          ? "resolved"
          : "unresolved";
      const targetFile = resolved.moduleFile ?? resolved.symbolFile;
      const local = leaf.alias ?? leaf.path[leaf.path.length - 1]!;

      recordEdge(
        ctx,
        {
          specifier,
          line,
          symbols: !leaf.glob && resolved.moduleFile === undefined && resolved.symbol ? [resolved.symbol] : [],
          ...(resolved.moduleFile !== undefined && !leaf.glob ? { alias: local } : {}),
          status,
          ...(targetFile !== undefined ? { resolvedPath: targetFile } : {}),
        },
        range,
        `Cannot resolve "use ${specifier};".`,
      );

      if (resolved.external || local === "self") continue;
      if (leaf.glob) {
        if (resolved.moduleFile !== undefined) {
          file.globs.push({ file: resolved.moduleFile, reexport });
        }
      } else if (resolved.moduleFile !== undefined) {
        addBinding(file, local, { kind: "namespace", file: resolved.moduleFile, reexport });
      } else {
        addBinding(file, local, {
          kind: "symbol",
          file: resolved.symbolFile,
          imported: resolved.symbol,
          reexport,
        });
      }
    }
  }
  return { edges: ctx.edges, issues: ctx.issues };
}

/** Flattens `a::{b, c as d, e::*}` into leaves. */
function expandRustUse(text: string, prefix: string[] = []): UseLeaf[] {
  const brace = text.indexOf("{");
  if (brace < 0) {
    const asMatch = text.match(/^(.*?)\s+as\s+([A-Za-z_]\w*)$/);
    const pathText = (asMatch ? asMatch[1]! : text).trim();
    const segs = pathText.split("::").map((s) => s.trim()).filter((s) => s !== "");
    if (segs[segs.length - 1] === "*") {
      return [{ path: [...prefix, ...segs.slice(0, -1)], glob: true }];
    }
    if (segs.length === 0) return [];
    return [{ path: [...prefix, ...segs], ...(asMatch ? { alias: asMatch[2]! } : {}), glob: false }];
  }
  const head = text
    .slice(0, brace)
    .split("::")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  let depth = 0;
  let end = -1;
  for (let i = brace; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  if (end < 0) return [];
  const parts: string[] = [];
  let current = "";
  depth = 0;
  for (const c of text.slice(brace + 1, end)) {
    if (c === "{") depth++;
    if (c === "}") depth--;
    if (c === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += c;
  }
  parts.push(current);
  const out: UseLeaf[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    if (trimmed === "self") {
      out.push({ path: [...prefix, ...head], glob: false });
    } else {
      out.push(...expandRustUse(trimmed, [...prefix, ...head]));
    }
  }
  return out;
}

function moduleDir(path: string): string {
  const base = basename(path);
  if (base === "lib.rs" || base === "main.rs" || base === "mod.rs") return dirname(path);
  return joinPath(dirname(path), base.replace(/\.rs$/, "")) ?? dirname(path);
}

function resolveRustModule(ctx: ImportContext, dir: string, name: string): string | undefined {
  for (const candidate of [`${name}.rs`, `${name}/mod.rs`]) {
    const p = joinPath(dir, candidate);
    if (p !== undefined && ctx.parsed.has(p)) return p;
  }
  return undefined;
}

/** Nearest `lib.rs` / `main.rs` at or above the importing file's directory. */
function crateRootFile(ctx: ImportContext): string | undefined {
  let dir = dirname(ctx.file.path);
  for (;;) {
    for (const root of ["lib.rs", "main.rs"]) {
      const p = joinPath(dir, root);
      if (p !== undefined && ctx.parsed.has(p)) return p;
    }
    if (dir === "") return undefined;
    dir = dirname(dir);
  }
}

function resolveRustUse(
  ctx: ImportContext,
  path: string[],
): { moduleFile?: string; symbolFile?: string; symbol?: string; external?: boolean } {
  let dir: string | undefined;
  let rest = path;
  let current = ctx.file.path;
  const first = path[0]!;
  if (first === "crate") {
    const rootFile = crateRootFile(ctx);
    if (rootFile === undefined) return {};
    dir = dirname(rootFile);
    current = rootFile;
    rest = path.slice(1);
  } else if (first === "self") {
    dir = moduleDir(ctx.file.path);
    rest = path.slice(1);
  } else if (first === "super") {
    dir = moduleDir(ctx.file.path);
    while (rest[0] === "super") {
      dir = dirname(dir);
      rest = rest.slice(1);
    }
    const parentFile = [`${dir}.rs`, ...["mod.rs", "lib.rs", "main.rs"].map((f) => joinPath(dir!, f))].find(
      (p) => p !== undefined && ctx.parsed.has(p),
    );
    current = parentFile ?? current;
  } else {
    const binding = ctx.file.bindings.get(first);
    if (binding?.kind === "namespace" && binding.file) {
      dir = moduleDir(binding.file);
      current = binding.file;
      rest = path.slice(1);
    } else {
      return { external: true };
    }
  }

  if (rest.length === 0) {
    return ctx.parsed.has(current) && current !== ctx.file.path ? { moduleFile: current } : {};
  }
  let i = 0;
  while (i < rest.length) {
    const next = resolveRustModule(ctx, dir, rest[i]!);
    if (next === undefined) break;
    current = next;
    dir = moduleDir(next);
    i++;
  }
  if (i === rest.length) return { moduleFile: current };
  return { symbolFile: current, symbol: rest[i]! };
}

// Vyper ────────────────────────────────────────────────────────────────────────

function extractVyper(ctx: ImportContext): ExtractedImports {
  const { file } = ctx;
  const text = file.importText;
  const starts = lineStarts(text);
  const importRe = /^import\s+([\w.]+)(?:\s+as\s+([A-Za-z_]\w*))?[ \t]*$/gm;
  for (let m = importRe.exec(text); m; m = importRe.exec(text)) {
    const specifier = m[1]!;
    const target = resolveVyperModule(ctx, specifier);
    const alias = m[2] ?? specifier.split(".").pop()!;
    recordEdge(
      ctx,
      {
        specifier,
        line: positionOf(starts, m.index).line,
        symbols: [],
        alias,
        status: target ? "resolved" : isExternalVyper(specifier) ? "external" : "unresolved",
        ...(target ? { resolvedPath: target } : {}),
      },
      [m.index, m.index + m[0].length],
      `Cannot resolve import "${specifier}".`,
    );
    addBinding(file, alias, {
      kind: "namespace",
      file: target,
      external: !target && isExternalVyper(specifier),
      reexport: false,
    });
  }

  const fromRe = /^from\s+(\.*[\w.]*)\s+import\s+([A-Za-z_]\w*)(?:\s+as\s+([A-Za-z_]\w*))?[ \t]*$/gm;
  for (let m = fromRe.exec(text); m; m = fromRe.exec(text)) {
    const modulePath = m[1]!;
    const name = m[2]!;
    const local = m[3] ?? name;
    const asModule = resolveVyperModule(ctx, joinDots(modulePath, name));
    const inModule = asModule ? undefined : resolveVyperModule(ctx, modulePath);
    const target = asModule ?? inModule;
    const specifier = `${modulePath} import ${name}`;
    recordEdge(
      ctx,
      {
        specifier,
        line: positionOf(starts, m.index).line,
        symbols: asModule ? [] : [name],
        ...(asModule ? { alias: local } : {}),
        status: target ? "resolved" : isExternalVyper(modulePath) ? "external" : "unresolved",
        ...(target ? { resolvedPath: target } : {}),
      },
      [m.index, m.index + m[0].length],
      `Cannot resolve "from ${modulePath} import ${name}".`,
    );
    const external = !target && isExternalVyper(modulePath);
    addBinding(
      file,
      local,
      asModule
        ? { kind: "namespace", file: asModule, external, reexport: false }
        : { kind: "symbol", file: inModule, external, imported: name, reexport: false },
    );
  }
  return { edges: ctx.edges, issues: ctx.issues };
}

function joinDots(modulePath: string, name: string): string {
  return modulePath.endsWith(".") ? modulePath + name : `${modulePath}.${name}`;
}

/** Vyper's `ethereum.ercs` and `vyper.*` stdlib imports are never in the repo. */
function isExternalVyper(specifier: string): boolean {
  return /^(ethereum|vyper)(\.|$)/.test(specifier);
}

function resolveVyperModule(ctx: ImportContext, specifier: string): string | undefined {
  const dots = specifier.match(/^\.*/)![0].length;
  const segs = specifier.slice(dots).split(".").filter((s) => s !== "");
  if (segs.length === 0) return undefined;
  const relPath = segs.join("/");
  const bases: string[] = [];
  if (dots > 0) {
    let dir = dirname(ctx.file.path);
    for (let i = 1; i < dots; i++) dir = dirname(dir);
    bases.push(dir);
  } else {
    bases.push(dirname(ctx.file.path), "");
  }
  for (const base of bases) {
    for (const ext of [".vy", ".vyi"]) {
      const p = joinPath(base, relPath + ext);
      if (p !== undefined && ctx.parsed.has(p)) return p;
    }
  }
  return undefined;
}

// ─── Reference resolution ─────────────────────────────────────────────────────

function lookupExport(
  parsed: Map<string, ParsedFile>,
  filePath: string,
  name: string,
  visiting: Set<string> = new Set(),
): SymbolDefinition[] {
  const key = `${filePath}\u0000${name}`;
  if (visiting.has(key)) return [];
  visiting.add(key);
  try {
    const file = parsed.get(filePath);
    if (!file) return [];

    const own = file.defs.get(name);
    if (own) return [own];

    const binding = file.bindings.get(name);
    if (binding?.reexport) {
      if (binding.file === undefined) return [];
      if (binding.kind === "namespace") {
        return [{ name, kind: "module", file: binding.file, line: 1 }];
      }
      return lookupExport(parsed, binding.file, binding.imported!, visiting);
    }

    const found: SymbolDefinition[] = [];
    for (const glob of file.globs) {
      if (!glob.reexport) continue;
      found.push(...lookupExport(parsed, glob.file, name, visiting));
    }
    return uniqueDefs(found);
  } finally {
    visiting.delete(key);
  }
}

function collectReferences(
  file: ParsedFile,
  parsed: Map<string, ParsedFile>,
  issues: ResolverIssue[],
): ResolvedReference[] {
  const scan = file.masked.split("");
  for (const [from, to] of file.importRanges) {
    for (let k = from; k < to; k++) if (scan[k] !== "\n" && scan[k] !== "\r") scan[k] = " ";
  }
  const text = scan.join("");
  const starts = lineStarts(text);
  const memberSep = file.language === "rust" ? "::" : ".";
  const refs: ResolvedReference[] = [];
  const emit = (ref: ResolvedReference) => {
    refs.push(ref);
    if (ref.status === "unresolved") {
      issues.push({
        code: "UNRESOLVED_SYMBOL",
        file: ref.file,
        line: ref.line,
        message: `"${ref.name}"${ref.via ? ` (via ${ref.via})` : ""} is imported but no definition was found.`,
      });
    } else if (ref.status === "ambiguous") {
      issues.push({
        code: "AMBIGUOUS_SYMBOL",
        file: ref.file,
        line: ref.line,
        message: `"${ref.name}" matches ${ref.candidates!.length} definitions: ${ref
          .candidates!.map((c) => `${c.file}:${c.line}`)
          .join(", ")}.`,
      });
    }
  };
  const classify = (
    binding: Binding,
    defs: SymbolDefinition[],
  ): Pick<ResolvedReference, "status" | "target" | "candidates"> => {
    if (defs.length === 1) return { status: "resolved", target: defs[0]! };
    if (defs.length > 1) return { status: "ambiguous", candidates: defs };
    return { status: binding.external ? "external" : "unresolved" };
  };
  const lookup = (binding: Binding, name: string): SymbolDefinition[] =>
    binding.file === undefined ? [] : lookupExport(parsed, binding.file, name);

  const idRe = /[A-Za-z_$][\w$]*/g;
  for (let m = idRe.exec(text); m; m = idRe.exec(text)) {
    const name = m[0];
    const before = text.slice(Math.max(0, m.index - 2), m.index).trimEnd();
    if (before.endsWith(".") || before.endsWith("::")) continue;
    if (file.defs.has(name)) continue;
    const { line, column } = positionOf(starts, m.index);
    const base = { file: file.path, line, column };

    const binding = file.bindings.get(name);
    if (binding?.kind === "symbol") {
      emit({ ...base, name, ...classify(binding, lookup(binding, binding.imported!)) });
    } else if (binding?.kind === "namespace") {
      const rest = text.slice(m.index + name.length);
      const member = rest.match(
        memberSep === "::" ? /^\s*::\s*([A-Za-z_]\w*)/ : /^\s*\.\s*([A-Za-z_$][\w$]*)/,
      );
      if (!member) continue;
      const pos = positionOf(starts, m.index + name.length + rest.indexOf(member[1]!));
      emit({
        file: file.path,
        line: pos.line,
        column: pos.column,
        name: member[1]!,
        via: name,
        ...classify(binding, lookup(binding, member[1]!)),
      });
    } else if (file.globs.length > 0) {
      const defs = uniqueDefs(file.globs.flatMap((glob) => lookupExport(parsed, glob.file, name)));
      if (defs.length > 0) {
        emit({ ...base, name, ...classify({ kind: "symbol", reexport: false }, defs) });
      }
    }
  }
  return refs;
}

// ─── Graph helpers ────────────────────────────────────────────────────────────

/** Tarjan's strongly connected components; returns groups with a real cycle. */
function findCycles(graph: Record<string, string[]>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];
  let counter = 0;

  const visit = (node: string) => {
    index.set(node, counter);
    low.set(node, counter);
    counter++;
    stack.push(node);
    onStack.add(node);
    for (const next of graph[node] ?? []) {
      if (!graph[next]) continue;
      if (!index.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node)!, low.get(next)!));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node)!, index.get(next)!));
      }
    }
    if (low.get(node) === index.get(node)) {
      const group: string[] = [];
      let top: string;
      do {
        top = stack.pop()!;
        onStack.delete(top);
        group.push(top);
      } while (top !== node);
      if (group.length > 1 || (graph[node] ?? []).includes(node)) result.push(group.sort(cmp));
    }
  };

  for (const node of Object.keys(graph).sort(cmp)) if (!index.has(node)) visit(node);
  return result.sort((a, b) => cmp(a[0]!, b[0]!));
}

// ─── Small utilities ──────────────────────────────────────────────────────────

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareDefs(a: SymbolDefinition, b: SymbolDefinition): number {
  return cmp(a.file, b.file) || a.line - b.line || cmp(a.name, b.name);
}

function uniqueDefs(defs: SymbolDefinition[]): SymbolDefinition[] {
  const seen = new Set<string>();
  const out: SymbolDefinition[] = [];
  for (const d of [...defs].sort(compareDefs)) {
    const key = `${d.file}\u0000${d.line}\u0000${d.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(d);
    }
  }
  return out;
}

function sortedRemappings(remappings?: Record<string, string>): Array<[string, string]> {
  return Object.entries(remappings ?? {}).sort(
    (a, b) => b[0].length - a[0].length || cmp(a[0], b[0]),
  );
}

function extname(path: string): string {
  const base = basename(path);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot).toLowerCase();
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/** Joins and normalizes; returns undefined when the result escapes the root. */
function joinPath(dir: string, rel: string): string | undefined {
  return normalizeFindingPath(dir === "" ? rel : `${dir}/${rel}`);
}
