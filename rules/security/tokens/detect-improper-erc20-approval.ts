export interface ImproperApproval {
  type: string;
  line: number;
  description: string;
  recommendation: string;
}

export interface ImproperERC20ApprovalResult {
  detected: boolean;
  approvals: ImproperApproval[];
  message: string;
  suggestion: string;
}

interface ApprovalPattern {
  type: string;
  pattern: RegExp;
  description: string;
  recommendation: string;
}

const APPROVAL_PATTERNS: ApprovalPattern[] = [
  {
    type: "direct-approve-overwrite",
    pattern: /\.approve\([^)]*\)/g,
    description:
      "Direct approve() call may overwrite existing allowance, enabling race conditions.",
    recommendation:
      "Use increaseAllowance() / decreaseAllowance() instead of approve() to prevent front-running attacks.",
  },
  {
    type: "unchecked-approval-return",
    pattern: /approve\([^)]*\);(?!\s*\{)/g,
    description:
      "approve() return value is not checked. The call may fail silently.",
    recommendation:
      "Check the boolean return value of approve() using require() or a safe wrapper like safeApprove().",
  },
];

function lineNumber(code: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (code[i] === "\n") line++;
  }
  return line;
}

export function detectImproperERC20Approval(
  code: string,
): ImproperERC20ApprovalResult {
  const approvals: ImproperApproval[] = [];

  for (const {
    type,
    pattern,
    description,
    recommendation,
  } of APPROVAL_PATTERNS) {
    const re = new RegExp(pattern.source, "g");
    let match: RegExpExecArray | null;
    while ((match = re.exec(code)) !== null) {
      approvals.push({
        type,
        line: lineNumber(code, match.index),
        description,
        recommendation,
      });
    }
  }

  if (approvals.length === 0) {
    return {
      detected: false,
      approvals: [],
      message: "No improper ERC20 approval patterns detected.",
      suggestion: "",
    };
  }

  return {
    detected: true,
    approvals,
    message: `Detected ${approvals.length} improper ERC20 approval pattern(s).`,
    suggestion:
      "Replace direct approve() with increaseAllowance() / decreaseAllowance() and always check return values.",
  };
}
