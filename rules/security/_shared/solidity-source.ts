/**
 * Shared Solidity source helpers for the arithmetic, time and signature detectors.
 *
 * These helpers work on source text, not on a compiler AST. They strip comments and string
 * literals (keeping offsets and line numbers intact), split a file into functions, split a
 * function into statements with block nesting, and find the `require` / `revert` guards that
 * precede a statement in the same or an enclosing block.
 *
 * Assumptions and limits (shared by every detector that uses this file):
 *  - Solidity 0.8.x semantics (checked arithmetic by default). Older sources get a warning.
 *  - Single-file analysis: inheritance, imports and library bodies are not resolved.
 *  - Guards are matched textually; a guard "covers" a variable when its condition mentions it.
 *  - Malformed or oversized input never throws: `validateSource` returns diagnostics instead.
 */
import { Severity } from "../../../libs/engine/core/analyzer-interface";

export const MAX_SOURCE_LENGTH = 2_000_000;

export type Confidence = "high" | "medium" | "low";

export interface Diagnostic {
  level: "error" | "warning" | "info";
  message: string;
}

export interface SolidityParam {
  type: string;
  name: string;
}

export interface SolidityFunction {
  name: string;
  kind: "function" | "constructor" | "modifier" | "receive" | "fallback";
  /** Text between the closing parenthesis of the parameter list and the opening brace. */
  header: string;
  params: SolidityParam[];
  visibility: "public" | "external" | "internal" | "private" | "default";
  mutability: "view" | "pure" | "payable" | "nonpayable";
  /** Function body, without the outer braces, taken from the sanitized source. */
  body: string;
  /** Index of the first body character in the sanitized source. */
  bodyStart: number;
  startLine: number;
  endLine: number;
}

export interface Statement {
  text: string;
  /** Index of the first character in the sanitized source. */
  start: number;
  line: number;
  /** "open" is a statement header ending in "{" (if, for, unchecked, ...); "close" is "}". */
  kind: "stmt" | "open" | "close";
  /** Ids of the blocks enclosing this statement, outermost first. */
  blockPath: number[];
}

export interface Guard {
  form: "require" | "revert-if" | "return-if";
  /** The condition text as written. For revert-if/return-if the condition must be false to continue. */
  condition: string;
  index: number;
  line: number;
  blockPath: number[];
}

export interface Assignment {
  lhs: string;
  rhs: string;
  declaredType?: string;
  statementIndex: number;
  line: number;
  compound: boolean;
}

export interface DetectorFinding {
  ruleId: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  confidence: Confidence;
  title: string;
  message: string;
  line: number;
  endLine: number;
  functionName?: string;
  /** Source lines or facts the detector relied on. */
  evidence: string[];
  /** Why this severity was chosen. */
  rationale: string;
  remediation: string;
}

export interface DetectorResult {
  ruleId: string;
  detected: boolean;
  findings: DetectorFinding[];
  diagnostics: Diagnostic[];
  limitations: string[];
  message: string;
  suggestion: string;
}

export interface NormalizedFinding {
  ruleId: string;
  message: string;
  severity: Severity;
  location: { file: string; startLine: number; endLine: number };
  suggestedFix: { description: string; documentationUrl: string };
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------------------
// Source preparation
// ---------------------------------------------------------------------------------------

/** Replaces comments and string-literal contents with spaces, keeping newlines and offsets. */
export function sanitizeSource(code: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    const n = code[i + 1];
    if (c === "/" && n === "/") {
      while (i < code.length && code[i] !== "\n") {
        out.push(" ");
        i++;
      }
    } else if (c === "/" && n === "*") {
      out.push(" ", " ");
      i += 2;
      while (i < code.length && !(code[i] === "*" && code[i + 1] === "/")) {
        out.push(code[i] === "\n" ? "\n" : " ");
        i++;
      }
      if (i < code.length) {
        out.push(" ", " ");
        i += 2;
      }
    } else if (c === '"' || c === "'") {
      out.push(c);
      i++;
      while (i < code.length && code[i] !== c && code[i] !== "\n") {
        if (code[i] === "\\" && i + 1 < code.length) {
          out.push(" ", " ");
          i += 2;
        } else {
          out.push(" ");
          i++;
        }
      }
      if (i < code.length && code[i] === c) {
        out.push(c);
        i++;
      }
    } else {
      out.push(c);
      i++;
    }
  }
  return out.join("");
}

export interface ValidatedSource {
  ok: boolean;
  clean: string;
  diagnostics: Diagnostic[];
}

/** Checks that the input is analyzable. Never throws; problems come back as diagnostics. */
export function validateSource(code: unknown): ValidatedSource {
  const diagnostics: Diagnostic[] = [];
  if (typeof code !== "string") {
    return { ok: false, clean: "", diagnostics: [{ level: "error", message: "Source must be a string." }] };
  }
  if (code.trim().length === 0) {
    return { ok: false, clean: "", diagnostics: [{ level: "error", message: "Source is empty." }] };
  }
  if (code.length > MAX_SOURCE_LENGTH) {
    return {
      ok: false,
      clean: "",
      diagnostics: [{ level: "error", message: `Source is larger than ${MAX_SOURCE_LENGTH} characters; skipped.` }],
    };
  }
  const clean = sanitizeSource(code);
  let depth = 0;
  let balanced = true;
  for (const ch of clean) {
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth < 0) {
        balanced = false;
        break;
      }
    }
  }
  if (!balanced || depth !== 0) {
    return {
      ok: false,
      clean,
      diagnostics: [{ level: "error", message: "Unbalanced braces: the source looks malformed or truncated; skipped." }],
    };
  }
  if (!/\b(contract|library|interface)\s+[A-Za-z_$]/.test(clean) && !/\bfunction\s/.test(clean)) {
    diagnostics.push({
      level: "info",
      message: "No Solidity contract or function declarations found; this input is not supported.",
    });
    return { ok: false, clean, diagnostics };
  }
  const pragma = /pragma\s+solidity\s+([^;]+);/.exec(clean);
  if (!pragma) {
    diagnostics.push({ level: "info", message: "No pragma solidity found; assuming 0.8.x semantics." });
  } else if (/(^|[^\d.])0\.[0-7]\./.test(pragma[1]) && !/0\.8\./.test(pragma[1])) {
    diagnostics.push({
      level: "warning",
      message: `pragma solidity ${pragma[1].trim()} is older than 0.8: arithmetic is unchecked by default and results assume 0.8.x semantics.`,
    });
  }
  return { ok: true, clean, diagnostics };
}

export function makeLineIndex(code: string): (index: number) => number {
  const starts = [0];
  for (let i = 0; i < code.length; i++) if (code[i] === "\n") starts.push(i + 1);
  return (index: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= index) lo = mid + 1;
      else hi = mid - 1;
    }
    return hi + 1;
  };
}

export function findMatching(text: string, openIndex: number, open = "{", close = "}"): number {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Splits on `sep` outside (), [] and {} nesting. */
export function splitTopLevel(text: string, sep = ","): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === sep && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim().length > 0) parts.push(current);
  return parts;
}

// ---------------------------------------------------------------------------------------
// Functions, parameters, statements
// ---------------------------------------------------------------------------------------

export function parseParams(text: string): SolidityParam[] {
  const params: SolidityParam[] = [];
  for (const raw of splitTopLevel(text)) {
    const tokens = raw.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const last = tokens[tokens.length - 1];
    const isLocation = /^(memory|calldata|storage|payable)$/.test(last);
    const name = tokens.length > 1 && !isLocation ? last : "";
    params.push({ type: tokens[0], name });
  }
  return params;
}

export function extractFunctions(clean: string): SolidityFunction[] {
  const lineOf = makeLineIndex(clean);
  const re = /\b(?:function\s+([A-Za-z_$][\w$]*)|(constructor)|modifier\s+([A-Za-z_$][\w$]*)|(receive)|(fallback))\s*(?=\()/g;
  const result: SolidityFunction[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    const parenOpen = clean.indexOf("(", m.index + m[0].length - 1);
    if (parenOpen < 0) continue;
    const parenClose = findMatching(clean, parenOpen, "(", ")");
    if (parenClose < 0) continue;
    let j = parenClose + 1;
    let depth = 0;
    while (j < clean.length) {
      const ch = clean[j];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (depth === 0 && (ch === "{" || ch === ";")) break;
      j++;
    }
    if (j >= clean.length || clean[j] !== "{") continue; // declaration without a body, or a call
    const bodyClose = findMatching(clean, j);
    if (bodyClose < 0) continue;
    const header = clean.slice(parenClose + 1, j);
    const kind: SolidityFunction["kind"] = m[2] ? "constructor" : m[3] ? "modifier" : m[4] ? "receive" : m[5] ? "fallback" : "function";
    const visibility = (/\b(public|external|internal|private)\b/.exec(header)?.[1] ?? "default") as SolidityFunction["visibility"];
    const mutability = (/\b(view|pure|payable)\b/.exec(header)?.[1] ?? "nonpayable") as SolidityFunction["mutability"];
    result.push({
      name: m[1] ?? m[3] ?? m[0].replace(/\s*$/, ""),
      kind,
      header,
      params: parseParams(clean.slice(parenOpen + 1, parenClose)),
      visibility,
      mutability,
      body: clean.slice(j + 1, bodyClose),
      bodyStart: j + 1,
      startLine: lineOf(m.index),
      endLine: lineOf(bodyClose),
    });
    re.lastIndex = bodyClose;
  }
  return result;
}

/** True for functions an outside caller can reach directly. */
export function isExternallyCallable(fn: SolidityFunction): boolean {
  return fn.kind === "function" && (fn.visibility === "public" || fn.visibility === "external");
}

export function splitStatements(fn: SolidityFunction, fullClean: string): Statement[] {
  const lineOf = makeLineIndex(fullClean);
  const body = fn.body;
  const out: Statement[] = [];
  const stack: number[] = [];
  let nextBlockId = 1;
  let parenDepth = 0;
  let begin = 0;
  const push = (end: number, kind: Statement["kind"]) => {
    const raw = body.slice(begin, end);
    const leading = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (text.length > 0 || kind === "close") {
      const start = fn.bodyStart + begin + leading;
      out.push({ text, start, line: lineOf(start), kind, blockPath: stack.slice() });
    }
  };
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "(" || ch === "[") parenDepth++;
    else if (ch === ")" || ch === "]") parenDepth--;
    else if (parenDepth === 0 && ch === ";") {
      push(i, "stmt");
      begin = i + 1;
    } else if (parenDepth === 0 && ch === "{") {
      push(i, "open");
      stack.push(nextBlockId++);
      begin = i + 1;
    } else if (parenDepth === 0 && ch === "}") {
      push(i, "stmt");
      stack.pop();
      out.push({ text: "}", start: fn.bodyStart + i, line: lineOf(fn.bodyStart + i), kind: "close", blockPath: stack.slice() });
      begin = i + 1;
    }
  }
  push(body.length, "stmt");
  return out;
}

function isPrefix(prefix: number[], path: number[]): boolean {
  if (prefix.length > path.length) return false;
  for (let i = 0; i < prefix.length; i++) if (prefix[i] !== path[i]) return false;
  return true;
}

function conditionOfIf(text: string): { condition: string; rest: string } | null {
  const m = /^if\s*\(/.exec(text);
  if (!m) return null;
  const open = text.indexOf("(");
  const close = findMatching(text, open, "(", ")");
  if (close < 0) return null;
  return { condition: text.slice(open + 1, close).trim(), rest: text.slice(close + 1).trim() };
}

const EXIT_RE = /^(revert\b|return\b|require\s*\(\s*false\b)/;

export function collectGuards(statements: Statement[]): Guard[] {
  const guards: Guard[] = [];
  statements.forEach((s, index) => {
    if (s.kind === "close") return;
    const req = /^(require|assert)\s*\(/.exec(s.text);
    if (req && s.kind === "stmt") {
      const open = s.text.indexOf("(");
      const close = findMatching(s.text, open, "(", ")");
      if (close > 0) {
        const args = splitTopLevel(s.text.slice(open + 1, close));
        guards.push({ form: "require", condition: (args[0] ?? "").trim(), index, line: s.line, blockPath: s.blockPath });
      }
      return;
    }
    const ifc = conditionOfIf(s.text);
    if (!ifc) return;
    if (s.kind === "stmt" && EXIT_RE.test(ifc.rest)) {
      guards.push({
        form: /^return\b/.test(ifc.rest) ? "return-if" : "revert-if",
        condition: ifc.condition,
        index,
        line: s.line,
        blockPath: s.blockPath,
      });
    } else if (s.kind === "open" && ifc.rest === "" && statements[index + 1] && EXIT_RE.test(statements[index + 1].text)) {
      guards.push({
        form: /^return\b/.test(statements[index + 1].text) ? "return-if" : "revert-if",
        condition: ifc.condition,
        index,
        line: s.line,
        blockPath: s.blockPath,
      });
    }
  });
  return guards;
}

/** Guards that execute before `statementIndex` on every path reaching it (same or enclosing block). */
export function dominatingGuards(statements: Statement[], guards: Guard[], statementIndex: number): Guard[] {
  const target = statements[statementIndex];
  return guards.filter((g) => g.index < statementIndex && isPrefix(g.blockPath, target.blockPath));
}

// ---------------------------------------------------------------------------------------
// Light dataflow
// ---------------------------------------------------------------------------------------

export function wordsIn(text: string): string[] {
  return text.match(/[A-Za-z_$][\w$]*/g) ?? [];
}

export function mentionsWord(text: string, word: string): boolean {
  if (!word) return false;
  return new RegExp(`(^|[^\\w$.])${word.replace(/[$]/g, "\\$")}(?![\\w$])`).test(text);
}

const TYPE_RE = "(?:u?int\\d*|address(?:\\s+payable)?|bool|bytes\\d*|string|[A-Z][\\w$]*)(?:\\[\\d*\\])*";

export function collectAssignments(statements: Statement[]): Assignment[] {
  const out: Assignment[] = [];
  statements.forEach((s, statementIndex) => {
    if (s.kind !== "stmt") return;
    const decl = new RegExp(`^(${TYPE_RE})\\s+(?:(?:memory|calldata|storage)\\s+)?([A-Za-z_$][\\w$]*)\\s*=\\s*([\\s\\S]+)$`).exec(s.text);
    if (decl && !/^(return|emit|revert|delete|require|assert)$/.test(decl[1])) {
      out.push({ lhs: decl[2], rhs: decl[3].trim(), declaredType: decl[1], statementIndex, line: s.line, compound: false });
      return;
    }
    const asg = /^([A-Za-z_$][\w$]*(?:\s*\[[^\]]*\])*(?:\.[A-Za-z_$][\w$]*)*)\s*([-+*/%|&^]|<<|>>)?=(?!=)\s*([\s\S]+)$/.exec(s.text);
    if (asg) {
      out.push({ lhs: asg[1].replace(/\s*\[[\s\S]*$/, ""), rhs: asg[3].trim(), statementIndex, line: s.line, compound: Boolean(asg[2]) });
    }
  });
  return out;
}

/** All identifiers a value derives from, following local assignments up to `maxDepth` steps. */
export function derivedFrom(name: string, assignments: Assignment[], beforeIndex: number, maxDepth = 6): Set<string> {
  const seen = new Set<string>([name]);
  let frontier = [name];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const v of frontier) {
      for (const a of assignments) {
        if (a.lhs !== v || a.statementIndex >= beforeIndex) continue;
        for (const w of wordsIn(a.rhs)) {
          if (!seen.has(w)) {
            seen.add(w);
            next.push(w);
          }
        }
      }
    }
    frontier = next;
  }
  return seen;
}

export interface IntTypeInfo {
  signed: boolean;
  bits: number;
}

export function intTypeInfo(type: string): IntTypeInfo | null {
  const m = /^(u?)int(\d*)$/.exec(type.trim());
  if (!m) return null;
  return { signed: m[1] === "", bits: m[2] ? parseInt(m[2], 10) : 256 };
}

// ---------------------------------------------------------------------------------------
// Results and normalization
// ---------------------------------------------------------------------------------------

export function buildResult(
  ruleId: string,
  findings: DetectorFinding[],
  diagnostics: Diagnostic[],
  limitations: string[],
  suggestion: string,
): DetectorResult {
  const hasError = diagnostics.some((d) => d.level === "error");
  return {
    ruleId,
    detected: findings.length > 0,
    findings,
    diagnostics,
    limitations,
    message: hasError
      ? `${ruleId}: input could not be analyzed (${diagnostics.filter((d) => d.level === "error").map((d) => d.message).join("; ")})`
      : findings.length > 0
        ? `${ruleId}: ${findings.length} finding(s)`
        : `${ruleId}: no findings`,
    suggestion,
  };
}

export function failedResult(ruleId: string, diagnostics: Diagnostic[], limitations: string[], suggestion: string): DetectorResult {
  return buildResult(ruleId, [], diagnostics, limitations, suggestion);
}

const SEVERITY_MAP: Record<DetectorFinding["severity"], Severity> = {
  critical: Severity.CRITICAL,
  high: Severity.HIGH,
  medium: Severity.MEDIUM,
  low: Severity.LOW,
  info: Severity.INFO,
};

/** Converts a detector result into the analyzer pipeline's normalized finding shape. */
export function toNormalizedFindings(result: DetectorResult, file: string): NormalizedFinding[] {
  return result.findings.map((f) => ({
    ruleId: f.ruleId,
    message: f.message,
    severity: SEVERITY_MAP[f.severity],
    location: { file, startLine: f.line, endLine: f.endLine },
    suggestedFix: { description: f.remediation, documentationUrl: `https://docs.gasguard.dev/rules/${f.ruleId}` },
    metadata: {
      title: f.title,
      confidence: f.confidence,
      function: f.functionName,
      evidence: f.evidence,
      rationale: f.rationale,
      diagnostics: result.diagnostics,
      limitations: result.limitations,
    },
  }));
}

export function sourceLine(code: string, line: number): string {
  return (code.split("\n")[line - 1] ?? "").trim();
}

// ---------------------------------------------------------------------------------------
// Types and block structure
// ---------------------------------------------------------------------------------------

/** Declared types of state variables (including mapping value types), keyed by variable name. */
export function collectStateTypes(clean: string): Map<string, string> {
  const types = new Map<string, string>();
  const mappingRe = /mapping\s*\([^;{}]*=>\s*([A-Za-z_$][\w$]*(?:\[\d*\])?)\s*\)\s*(?:public|private|internal|immutable|constant|\s)*([A-Za-z_$][\w$]*)\s*[;=]/g;
  let m: RegExpExecArray | null;
  while ((m = mappingRe.exec(clean)) !== null) types.set(m[2], m[1]);
  const plainRe = /(?<=^|[;{}])\s*((?:u?int\d*)|address|bool|bytes\d*|string)\s+(?:(?:public|private|internal|constant|immutable)\s+)*([A-Za-z_$][\w$]*)\s*(?:=[^;]*)?;/g;
  while ((m = plainRe.exec(clean)) !== null) {
    if (!types.has(m[2])) types.set(m[2], m[1]);
  }
  return types;
}

/** Declared types of function parameters and local variables. */
export function collectLocalTypes(fn: SolidityFunction, statements: Statement[]): Map<string, string> {
  const types = new Map<string, string>();
  for (const p of fn.params) if (p.name) types.set(p.name, p.type);
  const ret = /returns\s*\(([^)]*)\)/.exec(fn.header);
  if (ret) for (const p of parseParams(ret[1])) if (p.name) types.set(p.name, p.type);
  const declRe = new RegExp(`^(${TYPE_RE})\\s+(?:(?:memory|calldata|storage)\\s+)?([A-Za-z_$][\\w$]*)\\s*(?:=|$)`);
  for (const s of statements) {
    if (s.kind !== "stmt") continue;
    const d = declRe.exec(s.text);
    if (d && !/^(return|emit|revert|delete|require|assert|unchecked|else)$/.test(d[1])) types.set(d[2], d[1]);
  }
  return types;
}

/** Index of the statement that closes the block opened by statements[openIndex]. */
export function blockEnd(statements: Statement[], openIndex: number): number {
  const depth = statements[openIndex].blockPath.length;
  for (let j = openIndex + 1; j < statements.length; j++) {
    if (statements[j].kind === "close" && statements[j].blockPath.length === depth) return j;
  }
  return statements.length - 1;
}

/** Block-opening statements (if / for / while / unchecked ...) that enclose statements[index], innermost first. */
export function enclosingOpens(statements: Statement[], index: number): Statement[] {
  const result: Statement[] = [];
  for (let k = index - 1; k >= 0; k--) {
    const s = statements[k];
    if (s.kind === "open" && blockEnd(statements, k) >= index && k < index) result.push(s);
  }
  return result;
}

export function isLoopHeader(text: string): boolean {
  return /^(for|while)\s*\(/.test(text) || /^do$/.test(text);
}
