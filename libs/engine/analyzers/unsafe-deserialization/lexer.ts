/**
 * Minimal, dependency-free lexical helpers for the unsafe deserialization analyzer.
 */

const REGEX_PRECEDERS = new Set("(,=:[!&|?{};+-*%<>~^".split(""));
const REGEX_PRECEDING_KEYWORDS = /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|void|yield|await|delete|throw|new)$/;

/**
 * Replace comment bodies with spaces, preserving newlines and character offsets.
 * Supports JS/TS (//, /* *\/) and Python (#) single-line comments.
 */
export function maskComments(code: string, isPython = false): string {
  const out = code.split("");
  const n = code.length;
  let i = 0;
  let lastSignificant = "";

  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) {
      if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
    }
  };

  while (i < n) {
    const ch = code[i];
    const next = code[i + 1];

    if (isPython && ch === "#") {
      const end = code.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      blank(i, stop);
      i = stop;
      continue;
    }

    if (!isPython && ch === "/" && next === "/") {
      const end = code.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      blank(i, stop);
      i = stop;
      continue;
    }

    if (!isPython && ch === "/" && next === "*") {
      const end = code.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      i = skipQuoted(code, i);
      lastSignificant = ch;
      continue;
    }

    if (!isPython && ch === "/") {
      const startsRegex =
        lastSignificant === "" ||
        REGEX_PRECEDERS.has(lastSignificant) ||
        REGEX_PRECEDING_KEYWORDS.test(code.slice(Math.max(0, i - 12), i).trimEnd());
      if (startsRegex) {
        i = skipRegexLiteral(code, i);
        lastSignificant = "/";
        continue;
      }
    }

    if (!/\s/.test(ch)) lastSignificant = ch;
    i++;
  }

  return out.join("");
}

export function skipQuoted(code: string, start: number): number {
  const quote = code[start];
  // Python triple quotes
  if (code.slice(start, start + 3) === '"""' || code.slice(start, start + 3) === "'''") {
    const triple = code.slice(start, start + 3);
    const end = code.indexOf(triple, start + 3);
    return end === -1 ? code.length : end + 3;
  }

  let i = start + 1;
  while (i < code.length) {
    const ch = code[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    if (ch === "\n" && quote !== "`") return i;
    i++;
  }
  return code.length;
}

function skipRegexLiteral(code: string, start: number): number {
  let i = start + 1;
  let inClass = false;
  while (i < code.length) {
    const ch = code[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "\n") return i;
    if (inClass) {
      if (ch === "]") inClass = false;
    } else if (ch === "[") {
      inClass = true;
    } else if (ch === "/") {
      i++;
      while (i < code.length && /[a-z]/i.test(code[i])) i++;
      return i;
    }
    i++;
  }
  return code.length;
}

export function maskStringContents(expr: string): string {
  const out = expr.split("");
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === "'" || ch === '"') {
      const end = skipQuoted(expr, i);
      for (let k = i + 1; k < end - 1; k++) out[k] = " ";
      i = end;
      continue;
    }
    if (ch === "`") {
      let k = i + 1;
      let depth = 0;
      while (k < expr.length) {
        const c = expr[k];
        if (depth === 0 && c === "\\") {
          out[k] = " ";
          if (k + 1 < expr.length) out[k + 1] = " ";
          k += 2;
          continue;
        }
        if (depth === 0 && c === "`") break;
        if (depth === 0 && c === "$" && expr[k + 1] === "{") {
          depth = 1;
          k += 2;
          continue;
        }
        if (depth > 0) {
          if (c === "{") depth++;
          else if (c === "}") depth--;
          k++;
          continue;
        }
        out[k] = " ";
        k++;
      }
      i = k + 1;
      continue;
    }
    i++;
  }
  return out.join("");
}

const OPENERS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const CLOSERS = new Set([")", "]", "}"]);

export function readCallArgs(
  text: string,
  start: number,
  maxLength = 4000,
): { args: Array<{ text: string; offset: number }>; end: number } {
  const args: Array<{ text: string; offset: number }> = [];
  let depth = 0;
  let argStart = start;
  let i = start;
  const limit = Math.min(text.length, start + maxLength);

  while (i < limit) {
    const ch = text[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      i = skipQuoted(text, i);
      continue;
    }
    if (OPENERS[ch]) {
      depth++;
    } else if (CLOSERS.has(ch)) {
      if (depth === 0) {
        pushArg(args, text, argStart, i);
        return { args, end: i };
      }
      depth--;
    } else if (ch === "," && depth === 0) {
      pushArg(args, text, argStart, i);
      argStart = i + 1;
    }
    i++;
  }
  pushArg(args, text, argStart, i);
  return { args, end: i };
}

function pushArg(
  args: Array<{ text: string; offset: number }>,
  text: string,
  from: number,
  to: number,
): void {
  const raw = text.slice(from, to);
  const lead = raw.length - raw.trimStart().length;
  const trimmed = raw.trim();
  if (trimmed) args.push({ text: trimmed, offset: from + lead });
}

export class LineIndex {
  private readonly starts: number[] = [0];

  constructor(text: string) {
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "\n") this.starts.push(i + 1);
    }
  }

  get lineCount(): number {
    return this.starts.length;
  }

  position(offset: number): { line: number; column: number } {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - this.starts[lo] + 1 };
  }
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
