/**
 * Lexical helpers for the SQL Query analyzer.
 */

const REGEX_PRECEDERS = new Set("(,=:[!&|?{};+-*%<>~^".split(""));
const REGEX_PRECEDING_KEYWORDS = /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|void|yield|await|delete|throw|new)$/;

export function maskComments(code: string): string {
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

    if (ch === "/" && next === "/") {
      const end = code.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      blank(i, stop);
      i = stop;
      continue;
    }

    if (ch === "/" && next === "*") {
      const end = code.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }

    if (ch === "#") {
      const end = code.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      blank(i, stop);
      i = stop;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      if (
        (ch === "'" || ch === '"') &&
        code[i + 1] === ch &&
        code[i + 2] === ch
      ) {
        const triple = ch + ch + ch;
        const end = code.indexOf(triple, i + 3);
        const stop = end === -1 ? n : end + 3;
        i = stop;
        lastSignificant = ch;
        continue;
      }
      i = skipQuoted(code, i);
      lastSignificant = ch;
      continue;
    }

    if (ch === "/") {
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
