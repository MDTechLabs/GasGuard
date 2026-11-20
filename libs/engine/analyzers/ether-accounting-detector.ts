export interface EtherAccountingAssumption {
  line: number;
  startColumn: number;
  endColumn: number;
  variable: string;
}

export interface EtherAccountingDetection {
  assumptions: EtherAccountingAssumption[];
  diagnostics: string[];
}

const BALANCE = String.raw`address\s*\(\s*this\s*\)\s*\.\s*balance`;
const IDENTIFIER = String.raw`[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*`;
const TRACKED_ACCOUNTING_NAME =
  /deposit|liabilit|accounted|native.?balance|eth.?balance|escrow|reserve|credit|debt|backing|totalassets/i;

function maskCommentsAndStrings(
  source: string,
): { code: string; unterminated: boolean } {
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
        chars[i] = " ";
        if (next !== undefined && next !== "\n") {
          chars[i + 1] = " ";
          i++;
        }
      } else if (
        (state === "single" && current === "'") ||
        (state === "double" && current === '"')
      ) {
        chars[i] = " ";
        state = "code";
      } else if (current !== "\n") {
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
      chars[i] = " ";
      state = "single";
    } else if (current === '"') {
      chars[i] = " ";
      state = "double";
    }
  }

  return {
    code: chars.join(""),
    unterminated: state === "block" || state === "single" || state === "double",
  };
}

function findMatchingParen(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "(") depth++;
    if (source[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

function hasBalancedDelimiters(source: string): boolean {
  const expected: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  const stack: string[] = [];
  for (const char of source) {
    if (char === "(" || char === "[" || char === "{") stack.push(char);
    else if (char in expected && stack.pop() !== expected[char]) return false;
  }
  return stack.length === 0;
}

function hasUnsupportedSolidityPragma(source: string): boolean {
  const pragma = /\bpragma\s+solidity\s+([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = pragma.exec(source)) !== null) {
    const versions = [...match[1].matchAll(/(\d+)\.(\d+)\.(\d+)/g)];
    if (versions.length === 0) return true;
    for (const version of versions) {
      const major = Number(version[1]);
      const minor = Number(version[2]);
      const full = version[0];
      const before = match[1].slice(0, version.index).trimEnd();
      const exclusiveUpperBound = before.endsWith("<") && major === 0 && minor === 9;
      if (
        !exclusiveUpperBound &&
        (major !== 0 || minor < 4 || minor > 8)
      ) {
        return true;
      }
    }
  }
  return false;
}

function lineAndColumn(source: string, offset: number): { line: number; column: number } {
  const before = source.slice(0, offset);
  const lastNewline = before.lastIndexOf("\n");
  return {
    line: before.split("\n").length,
    column: offset - lastNewline,
  };
}

function unwrapParentheses(source: string, start: number, end: number): [number, number] {
  while (source[start] === "(" && source[end - 1] === ")") {
    if (findMatchingParen(source, start) !== end - 1) break;
    start++;
    end--;
  }
  return [start, end];
}

export function detectEtherAccountingAssumptions(
  input: unknown,
): EtherAccountingDetection {
  if (typeof input !== "string") {
    return {
      assumptions: [],
      diagnostics: ["Ether accounting analysis requires Solidity source text."],
    };
  }

  const masked = maskCommentsAndStrings(input);
  if (masked.unterminated) {
    return {
      assumptions: [],
      diagnostics: [
        "Ether accounting analysis skipped: Solidity source has an unterminated comment or string.",
      ],
    };
  }
  const code = masked.code;
  if (!hasBalancedDelimiters(code)) {
    return {
      assumptions: [],
      diagnostics: [
        "Ether accounting analysis skipped: Solidity source has unbalanced delimiters.",
      ],
    };
  }
  if (hasUnsupportedSolidityPragma(code)) {
    return {
      assumptions: [],
      diagnostics: [
        "Ether accounting analysis supports Solidity pragma versions 0.4.x through 0.8.x only.",
      ],
    };
  }

  const assumptions: EtherAccountingAssumption[] = [];
  const callPattern = /\b(?:require|assert)\s*\(/g;
  const equalityPattern = new RegExp(
    String.raw`^\s*(?:${BALANCE}\s*==\s*(${IDENTIFIER})|(${IDENTIFIER})\s*==\s*${BALANCE})\s*$`,
  );
  let call: RegExpExecArray | null;

  while ((call = callPattern.exec(code)) !== null) {
    const open = code.indexOf("(", call.index);
    const close = findMatchingParen(code, open);
    if (close < 0) continue;

    let conditionEnd = close;
    let nested = 0;
    for (let i = open + 1; i < close; i++) {
      if (code[i] === "(") nested++;
      else if (code[i] === ")") nested--;
      else if (code[i] === "," && nested === 0) {
        conditionEnd = i;
        break;
      }
    }

    const [conditionStart, unwrappedEnd] = unwrapParentheses(
      code,
      open + 1,
      conditionEnd,
    );
    const condition = code.slice(conditionStart, unwrappedEnd);
    const equality = equalityPattern.exec(condition);
    if (!equality) continue;

    const variable = (equality[1] ?? equality[2]).replace(/\s/g, "");
    if (!TRACKED_ACCOUNTING_NAME.test(variable)) continue;

    const expressionOffset = conditionStart + condition.search(/\S/);
    const { line, column } = lineAndColumn(input, expressionOffset);
    assumptions.push({
      line,
      startColumn: column,
      endColumn: column + condition.trim().length - 1,
      variable,
    });
  }

  return { assumptions, diagnostics: [] };
}
