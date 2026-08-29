// Detect missing function return documentation (issue #343)
export interface MissingReturnDocViolation {
  type: string;
  line: number;
  description: string;
  recommendation: string;
}

export interface MissingReturnDocResult {
  detected: boolean;
  violations: MissingReturnDocViolation[];
  message: string;
  suggestion: string;
}

// Matches functions that have a non-void return type but no @return / @returns NatSpec
const FN_WITH_RETURN = /function\s+\w+\s*\([^)]*\)\s*(?:public|private|internal|external|pure|view|payable|\s)*returns\s*\(/g;
const HAS_RETURN_DOC = /@returns?\s+/;

export function detectMissingReturnDocs(source: string): MissingReturnDocResult {
  const violations: MissingReturnDocViolation[] = [];
  const lines = source.split("\n");

  lines.forEach((line, idx) => {
    if (FN_WITH_RETURN.test(line)) {
      // Look back up to 5 lines for a @return / @returns NatSpec tag
      const window = lines.slice(Math.max(0, idx - 5), idx).join("\n");
      if (!HAS_RETURN_DOC.test(window)) {
        violations.push({
          type: "missing-return-docs",
          line: idx + 1,
          description: `Function at line ${idx + 1} returns a value but has no @return NatSpec comment.`,
          recommendation: "Add a /// @return <description> NatSpec comment above the function.",
        });
      }
    }
    FN_WITH_RETURN.lastIndex = 0; // reset stateful regex
  });

  return {
    detected: violations.length > 0,
    violations,
    message: violations.length > 0
      ? `Found ${violations.length} function(s) with missing return documentation.`
      : "All returning functions have return documentation.",
    suggestion: "Document every non-void return value with /// @return to improve auditability.",
  };
}
