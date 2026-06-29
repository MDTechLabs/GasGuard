export interface UnsafeDowncast {
  type: string;
  line: number;
  description: string;
  recommendation: string;
}

export interface UnsafeIntegerDowncastingResult {
  detected: boolean;
  downcasts: UnsafeDowncast[];
  message: string;
  suggestion: string;
}

interface DowncastPattern {
  type: string;
  pattern: RegExp;
  description: string;
  recommendation: string;
}

const DOWNCAST_PATTERNS: DowncastPattern[] = [
  {
    type: "explicit-narrowing-cast",
    pattern: /\b(?:uint\d+\(|int\d+\()\s*[a-zA-Z_]\w*\s*\)/g,
    description:
      "Explicit integer downcast may silently truncate value if the source exceeds the target range.",
    recommendation:
      "Use OpenZeppelin SafeCast or add an explicit bounds check before downcasting.",
  },
  {
    type: "solidity-downcast",
    pattern:
      /\buint(?:8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128)\s*\(/g,
    description:
      "Downcasting to smaller unsigned integer types may truncate high-order bits without warning.",
    recommendation:
      "Validate the value fits in the target type using SafeCast library or manual range checks.",
  },
  {
    type: "int-downcast",
    pattern: /\bint(?:8|16|24|32|40|48|56|64|72|80|88|96|104|112|120)\s*\(/g,
    description:
      "Downcasting to smaller signed integer types may silently truncate or produce unexpected negative values.",
    recommendation:
      "Use safe casting utilities and verify the value is within the valid range of the target type.",
  },
];

function lineNumber(code: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (code[i] === "\n") line++;
  }
  return line;
}

export function detectUnsafeIntegerDowncasting(
  code: string,
): UnsafeIntegerDowncastingResult {
  const downcasts: UnsafeDowncast[] = [];

  for (const {
    type,
    pattern,
    description,
    recommendation,
  } of DOWNCAST_PATTERNS) {
    const re = new RegExp(pattern.source, "g");
    let match: RegExpExecArray | null;
    while ((match = re.exec(code)) !== null) {
      downcasts.push({
        type,
        line: lineNumber(code, match.index),
        description,
        recommendation,
      });
    }
  }

  if (downcasts.length === 0) {
    return {
      detected: false,
      downcasts: [],
      message: "No unsafe integer downcasting detected.",
      suggestion: "",
    };
  }

  return {
    detected: true,
    downcasts,
    message: `Detected ${downcasts.length} unsafe integer downcast(s).`,
    suggestion:
      "Use SafeCast from OpenZeppelin or add bounds checks before downcasting to prevent silent truncation.",
  };
}
