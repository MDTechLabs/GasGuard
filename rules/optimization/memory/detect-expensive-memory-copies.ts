export interface ExpensiveMemoryCopy {
  type: string;
  line: number;
  description: string;
  recommendation: string;
}

export interface ExpensiveMemoryCopiesResult {
  detected: boolean;
  copies: ExpensiveMemoryCopy[];
  message: string;
  suggestion: string;
}

interface MemoryCopyPattern {
  type: string;
  pattern: RegExp;
  description: string;
  recommendation: string;
}

const MEMORY_COPY_PATTERNS: MemoryCopyPattern[] = [
  {
    type: "unnecessary-clone",
    pattern: /\.clone\(\)/g,
    description:
      "`.clone()` creates a deep copy of the data, incurring gas cost for large or complex types.",
    recommendation:
      "Use references (&T) where possible instead of cloning. Clone only when an owned copy is strictly necessary.",
  },
  {
    type: "string-to-string-copy",
    pattern: /String::from\(\s*\w+\s*\)|\.to_string\(\)|\.into\(\)/g,
    description:
      "String conversion or allocation creates a new heap allocation, which is expensive in Soroban contracts.",
    recommendation:
      "Use &str references or Symbol where possible. Avoid unnecessary String allocations in hot paths.",
  },
  {
    type: "vec-copy",
    pattern: /\.to_vec\(\)|\.iter\(\).*\.collect\(\)/g,
    description:
      "Copying an entire Vec or similar collection creates a deep copy of all elements.",
    recommendation:
      "Use slice references (&[T]) instead of copying the entire Vec when read-only access is sufficient.",
  },
  {
    type: "large-struct-copy",
    pattern:
      /fn\s+\w+\s*\([^)]*(?:&self|self|&mut self)[^)]*\)\s*->\s*\w+\s*\{[^}]*\b(?:clone|to_owned)\b/g,
    description:
      "Functions returning owned copies of large structs force unnecessary memory duplication.",
    recommendation:
      "Return references where the lifetime allows, or use Cow (clone-on-write) for conditional copying.",
  },
];

function lineNumber(code: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (code[i] === "\n") line++;
  }
  return line;
}

export function detectExpensiveMemoryCopies(
  code: string,
): ExpensiveMemoryCopiesResult {
  const copies: ExpensiveMemoryCopy[] = [];

  for (const {
    type,
    pattern,
    description,
    recommendation,
  } of MEMORY_COPY_PATTERNS) {
    const re = new RegExp(pattern.source, "g");
    let match: RegExpExecArray | null;
    while ((match = re.exec(code)) !== null) {
      copies.push({
        type,
        line: lineNumber(code, match.index),
        description,
        recommendation,
      });
    }
  }

  if (copies.length === 0) {
    return {
      detected: false,
      copies: [],
      message: "No expensive memory copies detected.",
      suggestion: "",
    };
  }

  return {
    detected: true,
    copies,
    message: `Detected ${copies.length} expensive memory copy operation(s).`,
    suggestion:
      "Use references (&T) instead of cloning, prefer &str over String, and avoid copying large collections.",
  };
}
