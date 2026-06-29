export interface UnsafeLowLevelCall {
  type: string;
  line: number;
  description: string;
  recommendation: string;
}

export interface UnsafeLowLevelCallsResult {
  detected: boolean;
  calls: UnsafeLowLevelCall[];
  message: string;
  suggestion: string;
}

interface LowLevelCallPattern {
  type: string;
  pattern: RegExp;
  description: string;
  recommendation: string;
}

const LOW_LEVEL_PATTERNS: LowLevelCallPattern[] = [
  {
    type: "raw-call",
    pattern: /\.call\s*\(/g,
    description:
      "Low-level .call() bypasses safety checks and may propagate errors silently.",
    recommendation:
      "Use higher-level abstractions (e.g. ISomeInterface) instead of raw .call(). Always check the return value.",
  },
  {
    type: "unchecked-call-result",
    pattern: /\.call\s*\{[^}]*\}\s*\([^;]*\);(?!\s*require)/g,
    description:
      "Raw .call() result is not checked. Failed calls will not revert the transaction.",
    recommendation:
      "Use require(success) after .call() or use the ReentrancyGuard pattern when interacting with external contracts.",
  },
  {
    type: "delegatecall-usage",
    pattern: /\.delegatecall\s*\(/g,
    description:
      "delegatecall() executes code in the caller context and may corrupt state.",
    recommendation:
      "Avoid delegatecall() where possible. When necessary, ensure the target contract is trusted and properly validated.",
  },
];

function lineNumber(code: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (code[i] === "\n") line++;
  }
  return line;
}

export function detectUnsafeLowLevelCalls(
  code: string,
): UnsafeLowLevelCallsResult {
  const calls: UnsafeLowLevelCall[] = [];

  for (const {
    type,
    pattern,
    description,
    recommendation,
  } of LOW_LEVEL_PATTERNS) {
    const re = new RegExp(pattern.source, "g");
    let match: RegExpExecArray | null;
    while ((match = re.exec(code)) !== null) {
      calls.push({
        type,
        line: lineNumber(code, match.index),
        description,
        recommendation,
      });
    }
  }

  if (calls.length === 0) {
    return {
      detected: false,
      calls: [],
      message: "No unsafe low-level calls detected.",
      suggestion: "",
    };
  }

  return {
    detected: true,
    calls,
    message: `Detected ${calls.length} unsafe low-level call(s): ${[...new Set(calls.map((c) => c.type))].join(", ")}.`,
    suggestion:
      "Use Solidity higher-level interfaces or safe wrappers. Always validate return values from external calls.",
  };
}
