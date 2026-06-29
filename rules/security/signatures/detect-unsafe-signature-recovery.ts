export interface UnsafeSignatureRecovery {
  type: string;
  line: number;
  description: string;
  recommendation: string;
}

export interface UnsafeSignatureRecoveryResult {
  detected: boolean;
  violations: UnsafeSignatureRecovery[];
  message: string;
  suggestion: string;
}

interface SignatureRecoveryPattern {
  type: string;
  pattern: RegExp;
  description: string;
  recommendation: string;
}

const SIGNATURE_PATTERNS: SignatureRecoveryPattern[] = [
  {
    type: "ecrecover-usage",
    pattern: /\becrecover\s*\(/g,
    description:
      "ecrecover() without proper signature malleability protections may allow signature forgery.",
    recommendation:
      "Use OpenZeppelin ECDSA library which handles malleability (v/r/s validation, EIP-2).",
  },
  {
    type: "no-malleability-check",
    pattern: /ecrecover\s*\([^)]*\)\s*(?![^;]*\brequire\b)/g,
    description:
      "ecrecover() result used without checking for signature malleability or invalid signature values.",
    recommendation:
      "Validate the s value is in the lower half of the secp256k1 curve and v is 27 or 28 (EIP-2).",
  },
  {
    type: "unchecked-recovery-result",
    pattern: /address\s+\w+\s*=\s*ecrecover\s*\([^)]*\)\s*;/g,
    description:
      "ecrecover() returns address(0) for invalid signatures, but the result is not validated.",
    recommendation:
      "Always check that the recovered address is not address(0) and matches the expected signer.",
  },
];

function lineNumber(code: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (code[i] === "\n") line++;
  }
  return line;
}

export function detectUnsafeSignatureRecovery(
  code: string,
): UnsafeSignatureRecoveryResult {
  const violations: UnsafeSignatureRecovery[] = [];

  for (const {
    type,
    pattern,
    description,
    recommendation,
  } of SIGNATURE_PATTERNS) {
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
      message: "No unsafe signature recovery patterns detected.",
      suggestion: "",
    };
  }

  return {
    detected: true,
    violations,
    message: `Detected ${violations.length} unsafe signature recovery pattern(s).`,
    suggestion:
      "Use OpenZeppelin ECDSA library for safe signature recovery with malleability protections.",
  };
}
