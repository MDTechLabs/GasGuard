export interface ExpensiveSLOAD {
  type: string;
  line: number;
  description: string;
  recommendation: string;
}

export interface ExpensiveSLOADResult {
  detected: boolean;
  sloads: ExpensiveSLOAD[];
  message: string;
  suggestion: string;
}

interface SLOADPattern {
  type: string;
  pattern: RegExp;
  description: string;
  recommendation: string;
}

const SLOAD_PATTERNS: SLOADPattern[] = [
  {
    type: "repeated-sload",
    pattern: /\.get\s*\([^)]+\)\s*;\s*(?:.|\n)*?\.get\s*\(/g,
    description:
      "Repeated SLOAD operations for the same storage key within a function. Each SLOAD costs gas.",
    recommendation:
      "Cache storage reads in a local variable at the start of the function to avoid repeated SLOAD costs.",
  },
  {
    type: "sload-in-loop",
    pattern:
      /(?:for|while)\s*[^{]*\{[^}]*?(?:storage|env\.storage)\(\)\.(?:instance|persistent|temporary)\(\)\.get\s*\(/g,
    description:
      "SLOAD operation inside a loop. Each iteration reads from storage, significantly increasing gas costs.",
    recommendation:
      "Read storage values into a local variable before the loop and reference the cached value inside the loop body.",
  },
  {
    type: "unbatched-sload",
    pattern:
      /(?:storage|env\.storage)\(\)\.(?:instance|persistent|temporary)\(\)\.get\s*\([^)]+\)\s*;\s*(?:\s*\/\/[^\n]*\n)*\s*(?:storage|env\.storage)\(\)\.(?:instance|persistent|temporary)\(\)\.get/g,
    description:
      "Multiple unbatched SLOAD operations. Each access incurs individual gas cost.",
    recommendation:
      "Batch related storage reads or cache them in local variables to reduce gas consumption.",
  },
];

function lineNumber(code: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (code[i] === "\n") line++;
  }
  return line;
}

export function detectExpensiveSLOADOperations(
  code: string,
): ExpensiveSLOADResult {
  const sloads: ExpensiveSLOAD[] = [];

  for (const { type, pattern, description, recommendation } of SLOAD_PATTERNS) {
    const re = new RegExp(pattern.source, "g");
    let match: RegExpExecArray | null;
    while ((match = re.exec(code)) !== null) {
      sloads.push({
        type,
        line: lineNumber(code, match.index),
        description,
        recommendation,
      });
    }
  }

  if (sloads.length === 0) {
    return {
      detected: false,
      sloads: [],
      message: "No expensive SLOAD operations detected.",
      suggestion: "",
    };
  }

  return {
    detected: true,
    sloads,
    message: `Detected ${sloads.length} expensive SLOAD pattern(s).`,
    suggestion:
      "Cache storage reads in local variables and avoid SLOAD operations inside loops to reduce gas costs.",
  };
}
