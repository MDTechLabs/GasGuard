/**
 * Shared lexical helpers for source-pattern Solidity detectors.
 *
 * These helpers never execute, compile, or resolve anything from the analyzed
 * project: they only inspect the source text that was handed to the analyzer.
 * Masked copies keep the exact length and newline positions of the input, so
 * offsets computed on a masked copy can be used to slice the original text.
 */

export interface MaskedSource {
  code: string;
  unterminated: boolean;
}

/**
 * Blanks comments (and, unless `keepStrings` is set, string literals) with
 * spaces while preserving offsets and newlines.
 */
export function maskSource(source: string, keepStrings = false): MaskedSource {
  const chars = source.split("");
  let state: "code" | "line" | "block" | "single" | "double" = "code";

  for (let i = 0; i < chars.length; i++) {
    const current = source[i];
    const next = source[i + 1];

    if (state === "line") {
      if (current === "\n") state = "code";
      else chars[i] = " ";
      continue;
    }
    if (state === "block") {
      if (current === "*" && next === "/") {
        chars[i] = " ";
        chars[i + 1] = " ";
        i++;
        state = "code";
      } else if (current !== "\n") {
        chars[i] = " ";
      }
      continue;
    }
    if (state === "single" || state === "double") {
      if (current === "\\") {
        if (!keepStrings) chars[i] = " ";
        if (next !== undefined && next !== "\n") {
          if (!keepStrings) chars[i + 1] = " ";
          i++;
        }
      } else if (
        (state === "single" && current === "'") ||
        (state === "double" && current === '"')
      ) {
        if (!keepStrings) chars[i] = " ";
        state = "code";
      } else if (current !== "\n" && !keepStrings) {
        chars[i] = " ";
      }
      continue;
    }

    if (current === "/" && next === "/") {
      chars[i] = " ";
      chars[i + 1] = " ";
      i++;
      state = "line";
    } else if (current === "/" && next === "*") {
      chars[i] = " ";
      chars[i + 1] = " ";
      i++;
      state = "block";
    } else if (current === "'") {
      if (!keepStrings) chars[i] = " ";
      state = "single";
    } else if (current === '"') {
      if (!keepStrings) chars[i] = " ";
      state = "double";
    }
  }

  return {
    code: chars.join(""),
    unterminated: state === "block" || state === "single" || state === "double",
  };
}

export function hasBalancedDelimiters(source: string): boolean {
  const expected: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  const stack: string[] = [];
  for (const char of source) {
    if (char === "(" || char === "[" || char === "{") stack.push(char);
    else if (char in expected && stack.pop() !== expected[char]) return false;
  }
  return stack.length === 0;
}

export function findMatchingClose(
  source: string,
  open: number,
  openChar = "(",
  closeChar = ")",
): number {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === openChar) depth++;
    else if (source[i] === closeChar && --depth === 0) return i;
  }
  return -1;
}

export function findMatchingOpen(
  source: string,
  close: number,
  openChar = "(",
  closeChar = ")",
): number {
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    if (source[i] === closeChar) depth++;
    else if (source[i] === openChar && --depth === 0) return i;
  }
  return -1;
}

/** Splits the text between a call's parentheses on top-level commas. */
export function splitTopLevelArguments(
  source: string,
  open: number,
  close: number,
): Array<{ start: number; end: number }> {
  const parts: Array<{ start: number; end: number }> = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < close; i++) {
    const char = source[i];
    if (char === "(" || char === "[" || char === "{") depth++;
    else if (char === ")" || char === "]" || char === "}") depth--;
    else if (char === "," && depth === 0) {
      parts.push({ start, end: i });
      start = i + 1;
    }
  }
  if (source.slice(start, close).trim() !== "" || parts.length > 0) {
    parts.push({ start, end: close });
  }
  return parts;
}

/**
 * Returns the offset at which the expression that ends at `end` begins when it
 * is a chain of identifiers, member accesses, calls, and index accesses, such as
 * `IERC20(token).approve` or `config.tokens[i].approve`.
 */
export function expressionChainStart(code: string, end: number): number {
  let start = end;
  let i = end - 1;
  for (;;) {
    while (i >= 0 && /\s/.test(code[i])) i--;
    let consumed = false;
    while (i >= 0 && (code[i] === ")" || code[i] === "]")) {
      const open = findMatchingOpen(code, i, code[i] === ")" ? "(" : "[", code[i]);
      if (open < 0) return start;
      i = open - 1;
      consumed = true;
      while (i >= 0 && /\s/.test(code[i])) i--;
    }
    const identifierEnd = i;
    while (i >= 0 && /[\w$]/.test(code[i])) i--;
    if (i !== identifierEnd) consumed = true;
    if (!consumed) return start;
    start = i + 1;
    let j = i;
    while (j >= 0 && /\s/.test(code[j])) j--;
    if (j >= 0 && code[j] === ".") {
      i = j - 1;
      continue;
    }
    return start;
  }
}

/**
 * Offset just after the previous statement or block boundary (`;`, `{`, `}`)
 * before `offset`. Parentheses are deliberately not boundaries so that the
 * text between the boundary and `offset` includes wrappers such as `require(`.
 */
export function statementStart(code: string, offset: number): number {
  for (let i = offset - 1; i >= 0; i--) {
    if (code[i] === ";" || code[i] === "{" || code[i] === "}") return i + 1;
  }
  return 0;
}

/** Text from `from` to the end of the innermost enclosing block. */
export function restOfEnclosingBlock(code: string, from: number): string {
  let depth = 0;
  for (let i = from; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}" && depth-- === 0) return code.slice(from, i);
  }
  return code.slice(from);
}

/**
 * Solidity 0.4.x through 0.8.x are supported. Sources without a pragma are
 * accepted; any explicit version outside the range is reported as unsupported.
 */
export function hasUnsupportedSolidityPragma(source: string): boolean {
  const pragma = /\bpragma\s+solidity\s+([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = pragma.exec(source)) !== null) {
    const versions = [...match[1].matchAll(/(\d+)\.(\d+)\.(\d+)/g)];
    if (versions.length === 0) return true;
    for (const version of versions) {
      const major = Number(version[1]);
      const minor = Number(version[2]);
      const before = match[1].slice(0, version.index).trimEnd();
      const exclusiveUpperBound = before.endsWith("<") && major === 0 && minor === 9;
      if (!exclusiveUpperBound && (major !== 0 || minor < 4 || minor > 8)) {
        return true;
      }
    }
  }
  return false;
}

export function lineAndColumn(
  source: string,
  offset: number,
): { line: number; column: number } {
  const before = source.slice(0, offset);
  const lastNewline = before.lastIndexOf("\n");
  return {
    line: before.split("\n").length,
    column: offset - lastNewline,
  };
}

export type SourcePreparation =
  | { ok: true; code: string; text: string }
  | { ok: false; diagnostic: string };

/**
 * Validates and masks source for a detector. `code` has comments and strings
 * blanked; `text` has only comments blanked so literals (selectors, imports)
 * remain inspectable. Both share offsets with the original source.
 */
export function prepareSoliditySource(
  input: unknown,
  analysisName: string,
): SourcePreparation {
  if (typeof input !== "string") {
    return { ok: false, diagnostic: `${analysisName} analysis requires Solidity source text.` };
  }
  const masked = maskSource(input);
  if (masked.unterminated) {
    return {
      ok: false,
      diagnostic: `${analysisName} analysis skipped: Solidity source has an unterminated comment or string.`,
    };
  }
  if (!hasBalancedDelimiters(masked.code)) {
    return {
      ok: false,
      diagnostic: `${analysisName} analysis skipped: Solidity source has unbalanced delimiters.`,
    };
  }
  if (hasUnsupportedSolidityPragma(masked.code)) {
    return {
      ok: false,
      diagnostic: `${analysisName} analysis supports Solidity pragma versions 0.4.x through 0.8.x only.`,
    };
  }
  return { ok: true, code: masked.code, text: maskSource(input, true).code };
}

export interface FunctionModel {
  name: string;
  /** Offset of the `function` keyword. */
  start: number;
  params: Array<{ name: string; type: string }>;
  /** Offsets of the `{` and matching `}`; -1 when the function has no body (interface or abstract). */
  bodyStart: number;
  bodyEnd: number;
  header: string;
}

/** Extracts function definitions (with or without bodies) from masked source. */
export function extractFunctions(code: string): FunctionModel[] {
  const functions: FunctionModel[] = [];
  const pattern = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code)) !== null) {
    const open = match.index + match[0].length - 1;
    const close = findMatchingClose(code, open);
    if (close < 0) continue;

    let i = close + 1;
    while (i < code.length && code[i] !== "{" && code[i] !== ";") {
      if (code[i] === "(") {
        const end = findMatchingClose(code, i);
        if (end < 0) break;
        i = end;
      }
      i++;
    }
    if (i >= code.length) continue;

    const params = splitTopLevelArguments(code, open, close)
      .map(({ start, end }) => code.slice(start, end).trim().split(/\s+/))
      .filter((parts) => parts[0] !== "")
      .map((parts) => ({
        type: parts[0],
        name: parts.length > 1 ? parts[parts.length - 1] : "",
      }));

    const hasBody = code[i] === "{";
    functions.push({
      name: match[1],
      start: match.index,
      params,
      bodyStart: hasBody ? i : -1,
      bodyEnd: hasBody ? findMatchingClose(code, i, "{", "}") : -1,
      header: code.slice(match.index, i),
    });
  }
  return functions;
}

/** True when the first pragma pins a compiler older than 0.8 (no checked arithmetic). */
export function usesLegacyArithmetic(code: string): boolean {
  const pragma = /\bpragma\s+solidity\s+[^;]*?(\d+)\.(\d+)\.\d+/.exec(code);
  return pragma !== null && Number(pragma[1]) === 0 && Number(pragma[2]) < 8;
}
