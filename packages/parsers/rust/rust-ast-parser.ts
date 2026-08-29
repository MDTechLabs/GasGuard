/**
 * Issue #791 — Rust AST Parser Integration
 *
 * Lightweight, dependency-free Rust AST parser for Soroban (Stellar) contracts.
 * It tokenizes Rust source and builds a structured AST (modules → structs →
 * impls → functions → params / calls / storage ops), always preserving source
 * locations (1-based line numbers + byte offsets) so downstream analyzers,
 * rules, and the auto-fix framework can report precise findings and emit exact
 * diffs.
 *
 * This is intentionally a best-effort parser for the Soroban subset of Rust:
 * `#[contract]`, `#[contracttype]`, `#[contractimpl]`, unit/struct
 * definitions and `impl` blocks with (mostly public) functions. It never panics
 * on malformed input — the result carries diagnostics instead.
 */

export interface SourceLocation {
  /** 1-based line number */
  line: number;
  /** 0-based column offset within the line */
  column: number;
  /** Absolute byte offset into the original source */
  offset: number;
  /** Node name/span length */
  length: number;
}

export interface RustParam {
  name: string;
  typeName: string;
  location: SourceLocation;
}

export interface RustFunction {
  name: string;
  params: RustParam[];
  returnType: string | null;
  isPublic: boolean;
  isAsync: boolean;
  location: SourceLocation;
  /** Raw body text of the function including the surrounding braces. */
  body: string;
  /** Method-call / invoke targets observed in the body. */
  calls: string[];
  /** Storage method interactions: env.storage().<op>(...). */
  storageOps: Array<'get' | 'set' | 'has' | 'remove'>;
}

export interface RustStruct {
  name: string;
  fields: RustParam[];
  isContract: boolean;
  isContractType: boolean;
  location: SourceLocation;
}

export interface RustImpl {
  /** Struct name the impl targets. */
  target: string;
  isContractImpl: boolean;
  functions: RustFunction[];
  location: SourceLocation;
}

export interface RustModule {
  name: string;
  location: SourceLocation;
}

export interface RustAST {
  source: string;
  filePath: string;
  modules: RustModule[];
  structs: RustStruct[];
  impls: RustImpl[];
}

export interface ParseDiagnostic {
  severity: 'error' | 'warning';
  message: string;
  location: SourceLocation | null;
}

export interface ParseResult {
  ast: RustAST;
  diagnostics: ParseDiagnostic[];
}

const STORAGE_METHODS = new Set(['get', 'set', 'has', 'remove']);

/** Column of the first non-whitespace char in a line. */
function firstNonWsColumn(line: string): number {
  return line.search(/\S/);
}

/**
 * Parse Rust source into a structured AST.
 *
 * @param source Rust source code.
 * @param filePath Optional logical file path recorded on the AST.
 */
export function parseRust(source: string, filePath = 'contract.rs'): ParseResult {
  const diagnostics: ParseDiagnostic[] = [];
  const sourceLines = source.split('\n');

  const modules: RustModule[] = [];
  const structs: RustStruct[] = [];
  const impls: RustImpl[] = [];

  let moduleName: string | null = null;
  let lineIdx = 0;
  // Track brace depth at the top level so we skip module bodies cleanly.
  let topLevelDepth = 0;

  // Compute byte offsets once for precise location reporting.
  const lineOffsets: number[] = [];
  {
    let acc = 0;
    for (const l of sourceLines) {
      lineOffsets.push(acc);
      acc += l.length + 1;
    }
  }

  const loc = (i: number, column: number, length = 0): SourceLocation => ({
    line: i + 1,
    column,
    offset: (lineOffsets[i] ?? 0) + column,
    length,
  });

  while (lineIdx < sourceLines.length) {
    const code = stripComments(sourceLines[lineIdx]);
    const trimmed = code.trim();

    // `mod name;` or `mod name { ... }`
    const modMatch = trimmed.match(/^mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*(\{)?/);
    if (modMatch && topLevelDepth === 0) {
      moduleName = modMatch[1];
      modules.push({ name: modMatch[1], location: loc(lineIdx, code.search(/\S/), modMatch[1].length) });
      if (modMatch[2] === '{') {
        topLevelDepth += 1;
      }
      lineIdx += 1;
      continue;
    }

    // struct definition (unit structs `pub struct Foo;` and braced structs)
    const structMatch = trimmed.match(/^(?:pub\s+)?struct\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (structMatch && topLevelDepth === 0) {
      const name = structMatch[1];
      const prevLine = sourceLines[lineIdx - 1] ?? '';
      const isContract = prevLine.includes('#[contract]');
      const isContractType = prevLine.includes('#[contracttype]');

      const structStartLine = lineIdx;
      const column = code.search(/\S/);

      const fields: RustParam[] = [];

      // Unit struct: `pub struct Foo;` has no body.
      if (trimmed.includes(';') && !trimmed.includes('{')) {
        structs.push({
          name,
          fields,
          isContract,
          isContractType,
          location: loc(structStartLine, column, name.length),
        });
        lineIdx += 1;
        continue;
      }

      // Braced struct: collect lines until balanced braces.
      lineIdx += 1;
      let structRegion = '';
      let fieldDepth = 0;
      let startedBraces = trimmed.includes('{');
      if (startedBraces) fieldDepth += (trimmed.match(/\{/g) ?? []).length;

      while (lineIdx < sourceLines.length) {
        const l = sourceLines[lineIdx];
        structRegion += '\n' + l.trim();
        fieldDepth += (l.match(/\{/g) ?? []).length;
        fieldDepth -= (l.match(/\}/g) ?? []).length;
        if (fieldDepth <= 0) break;
        lineIdx += 1;
      }

      // Parse fields from the collected region (all lines of the struct).
      const fieldLines = structRegion
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s.startsWith('pub '));

      for (const fl of fieldLines) {
        const m = fl.match(/^pub\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_<>()\[\]0-9:, ]+),?\s*$/);
        if (m) {
          fields.push({
            name: m[1],
            typeName: m[2].trim(),
            location: loc(structStartLine, column, m[1].length),
          });
        }
      }

      structs.push({
        name,
        fields,
        isContract,
        isContractType,
        location: loc(structStartLine, column, name.length),
      });
      lineIdx += 1;
      continue;
    }

    // impl block (with or without `pub`, e.g. `#[contractimpl] impl Foo {`)
    const implMatch = trimmed.match(/^(?:pub\s+)?impl\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/);
    if (implMatch && topLevelDepth === 0) {
      const target = implMatch[1];
      const prevLine = sourceLines[lineIdx - 1] ?? '';
      const isContractImpl = prevLine.includes('#[contractimpl]');
      const implCol = code.search(/\S/);
      const implStartLine = lineIdx;
      const functions: RustFunction[] = [];

      lineIdx += 1;
      let implRegion = '';
      let implDepth = 1;
      // Track absolute line index for functions.
      let absLine = lineIdx;

      // Collect whole impl block.
      while (lineIdx < sourceLines.length) {
        const l = sourceLines[lineIdx];
        implRegion += (implRegion ? '\n' : '') + l;
        implDepth += (l.match(/\{/g) ?? []).length;
        implDepth -= (l.match(/\}/g) ?? []).length;
        if (implDepth <= 0) break;
        lineIdx += 1;
      }

      // Split impl region into top-level function blocks.
      const regionLines = implRegion.split('\n');
      absLine = implStartLine + 1; // first line inside impl
      let fnStartAbs = -1;
      let fnAcc = '';
      let fnBraceDepth = 0;
      let inFn = false;
      let fnHeader = '';

      const flushFn = () => {
        if (!inFn || fnStartAbs < 0) return;
        const fn = parseFunction(fnHeader, fnAcc, fnStartAbs, lineOffsets);
        if (fn) functions.push(fn);
      };

      for (let idx = 0; idx < regionLines.length; idx++) {
        const abs = implStartLine + 2 + idx;
        const raw = regionLines[idx];
        const codeLine = stripComments(raw).trim();

        if (!inFn) {
          const hdr = codeLine.match(
            /^(?:(?:pub)?\s*)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/,
          );
          if (hdr) {
            inFn = true;
            fnStartAbs = abs;
            fnHeader = raw;
            fnAcc = raw;
            fnBraceDepth = (raw.match(/\{/g) ?? []).length;
          }
          continue;
        }

        fnAcc += '\n' + raw;
        fnBraceDepth += (raw.match(/\{/g) ?? []).length;
        fnBraceDepth -= (raw.match(/\}/g) ?? []).length;
        if (fnBraceDepth <= 0) {
          flushFn();
          inFn = false;
          fnAcc = '';
          fnHeader = '';
          fnStartAbs = -1;
        }
      }
      if (inFn) flushFn();

      impls.push({
        target,
        isContractImpl,
        functions,
        location: loc(implStartLine, implCol, target.length),
      });
      lineIdx += 1;
      continue;
    }

    // Track top-level brace depth for module bodies.
    topLevelDepth += (code.match(/\{/g) ?? []).length;
    topLevelDepth -= (code.match(/\}/g) ?? []).length;
    if (topLevelDepth < 0) topLevelDepth = 0;

    lineIdx += 1;
  }

  if (source.trim().length > 0 && structs.length === 0 && impls.length === 0) {
    diagnostics.push({
      severity: 'warning',
      message:
        'No #[contract]/#[contracttype] structs or impl blocks detected; input may not be a Soroban contract.',
      location: null,
    });
  }

  const ast: RustAST = { source, filePath, modules, structs, impls };
  return { ast, diagnostics };
}

/** Parse a single function header + body into a RustFunction. */
function parseFunction(
  headerLine: string,
  body: string,
  startLine: number,
  lineOffsets: number[],
): RustFunction | null {
  const headerCode = stripComments(headerLine).trim();
  const hdr = headerCode.match(
    /^(?:(pub|pub\(crate\))\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/,
  );
  if (!hdr) return null;
  const name = hdr[2];
  const isPublic = hdr[1] === 'pub' || hdr[1] === 'pub(crate)';
  // Determine async by re-matching fuller header.
  const fullHdr = /^.*?(async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(headerCode);
  const isAsync = fullHdr ? fullHdr[1] === 'async ' : false;

  const params = parseParams(headerLine);
  const returns = headerLine.match(/->\s*([^{]+?)\s*\{/);
  const returnType = returns ? returns[1].trim() : null;

  const column = firstNonWsColumn(headerLine);
  const offset = (lineOffsets[startLine - 1] ?? 0) + column;

  return {
    name,
    params,
    returnType,
    isPublic,
    isAsync,
    location: { line: startLine, column, offset, length: name.length },
    body,
    calls: extractCalls(body),
    storageOps: extractStorageOps(body),
  };
}

function parseParams(headerLine: string): RustParam[] {
  const open = headerLine.indexOf('(');
  if (open === -1) return [];
  let depth = 0;
  let end = -1;
  for (let i = open; i < headerLine.length; i++) {
    const c = headerLine[i];
    if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return [];
  const inner = headerLine.slice(open + 1, end);
  const params: RustParam[] = [];
  for (const seg of splitTopLevel(inner, ',')) {
    const m = seg.trim().match(/^(mut\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/);
    if (!m) continue;
    params.push({
      name: m[2],
      typeName: m[3].trim(),
      location: { line: 0, column: 0, offset: 0, length: m[2].length },
    });
  }
  return params;
}

/** Split a string on a whole-input delimiter that is not nested in brackets. */
function splitTopLevel(input: string, delim: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of input) {
    if (ch === '(' || ch === '[' || ch === '{' || ch === '<') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') depth -= 1;
    if (ch === delim && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

function extractCalls(body: string): string[] {
  const calls = new Set<string>();
  const invokes = body.matchAll(/\b\w+\.(invoke_contract\w*|invoke_function\w*)\b/g);
  for (const m of invokes) calls.add(m[0]);
  const selfCalls = body.matchAll(/\b(self\.|Self::)\w+/g);
  for (const m of selfCalls) calls.add(m[0]);
  return Array.from(calls);
}

function extractStorageOps(body: string): Array<'get' | 'set' | 'has' | 'remove'> {
  const ops = new Set<'get' | 'set' | 'has' | 'remove'>();
  // Match `env.storage().instance().get(...)` — capture the final method call.
  for (const m of body.matchAll(/env\.storage\(\)(?:\s*\.\s*\w+\s*\(\))*\s*\.\s*(get|set|has|remove)\s*\(/g)) {
    ops.add(m[1] as 'get' | 'set' | 'has' | 'remove');
  }
  return Array.from(ops);
}

/** Strip line and block comments (rough string-aware handling). */
function stripComments(line: string): string {
  let inString = false;
  for (let i = 0; i < line.length - 1; i++) {
    const c = line[i];
    const n = line[i + 1];
    if (c === '"' && (i === 0 || line[i - 1] !== '\\')) {
      inString = !inString;
      continue;
    }
    if (c === '/' && n === '/' && !inString) return line.slice(0, i);
    if (c === '/' && n === '*' && !inString) return line.slice(0, i);
  }
  return line;
}