export interface MissingInterfaceViolation {
  type: string;
  line: number;
  description: string;
  recommendation: string;
}

export interface MissingContractInterfaceResult {
  detected: boolean;
  violations: MissingInterfaceViolation[];
  message: string;
  suggestion: string;
}

interface DirectInteractionPattern {
  type: string;
  pattern: RegExp;
  description: string;
  recommendation: string;
}

const INTERACTION_PATTERNS: DirectInteractionPattern[] = [
  {
    type: "direct-abi-encode",
    pattern:
      /abi\.encodeWithSignature|abi\.encodeWithSelector|abi\.encodeCall/g,
    description:
      "Direct ABI encoding bypasses type safety and interface validation.",
    recommendation:
      "Define and import an interface (e.g., IERC20) instead of using raw abi.encodeWithSignature calls.",
  },
  {
    type: "raw-address-cast",
    pattern: /(?:I[A-Z]\w*)?\(\s*address\s*\(/g,
    description:
      "Casting an address to a contract type without a proper interface may hide interface mismatches.",
    recommendation:
      "Use a well-defined interface and cast to the interface type, not raw address.",
  },
  {
    type: "inline-interface",
    pattern: /interface\s+\w+\s*\{[^}]*\bfunction\b[^}]*\}\s*$/gm,
    description:
      "Inline or local interface definitions may lead to duplication and maintenance issues.",
    recommendation:
      "Extract interfaces into shared modules for reuse and consistency across the codebase.",
  },
];

function lineNumber(code: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (code[i] === "\n") line++;
  }
  return line;
}

export function detectMissingContractInterface(
  code: string,
): MissingContractInterfaceResult {
  const violations: MissingInterfaceViolation[] = [];

  for (const {
    type,
    pattern,
    description,
    recommendation,
  } of INTERACTION_PATTERNS) {
    const re = new RegExp(pattern.source, "g");
    let match: RegExpExecArray | null;
    while ((match = re.exec(code)) !== null) {
      violations.push({
        type,
        line: lineNumber(code, match.index),
        description,
        recommendation,
      });
    }
  }

  if (violations.length === 0) {
    return {
      detected: false,
      violations: [],
      message: "No missing contract interface issues detected.",
      suggestion: "",
    };
  }

  return {
    detected: true,
    violations,
    message: `Detected ${violations.length} instance(s) of missing or improper interface usage.`,
    suggestion:
      "Always use well-defined interfaces for external contract interactions to improve readability and safety.",
  };
}
