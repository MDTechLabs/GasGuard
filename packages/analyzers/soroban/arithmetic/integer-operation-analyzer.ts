/**
 * Issue #799 — Soroban Integer Operation Analyzer
 *
 * Detects repeated, constant, and avoidable arithmetic operations in
 * Soroban (Rust) contract source. Provides optimization guidance with
 * source locations.
 */

export type Severity = 'high' | 'medium' | 'low' | 'info';

export interface ArithmeticPattern {
  id: string;
  description: string;
  pattern: RegExp;
  severity: Severity;
  suggestion: string;
}

export interface ArithmeticFinding {
  ruleId: string;
  severity: Severity;
  line: number;
  message: string;
  suggestion: string;
  patternId: string;
}

export interface IntegerOperationReport {
  findings: ArithmeticFinding[];
  summary: string;
}

const ARITHMETIC_PATTERNS: ArithmeticPattern[] = [
  {
    id: 'multiply-by-one',
    description: 'Multiplication by 1 (no-op)',
    pattern: /\*\s*1\b|\b1\s*\*/,
    severity: 'low',
    suggestion: 'Remove multiplication by 1 — it has no effect.',
  },
  {
    id: 'add-zero',
    description: 'Addition of 0 (no-op)',
    pattern: /\+\s*0\b|\b0\s*\+/,
    severity: 'low',
    suggestion: 'Remove addition of 0 — it has no effect.',
  },
  {
    id: 'divide-by-one',
    description: 'Division by 1 (no-op)',
    pattern: /\/\s*1\b/,
    severity: 'low',
    suggestion: 'Remove division by 1 — it has no effect.',
  },
  {
    id: 'power-of-two-multiply',
    description: 'Multiplication by power-of-two — prefer bit shift',
    pattern: /\*\s*(2|4|8|16|32|64|128|256|512|1024)\b/,
    severity: 'low',
    suggestion: 'Replace `x * N` with `x << k` where N = 2^k for cheaper bit-shift arithmetic.',
  },
  {
    id: 'power-of-two-divide',
    description: 'Division by power-of-two — prefer bit shift',
    pattern: /\/\s*(2|4|8|16|32|64|128|256|512|1024)\b/,
    severity: 'low',
    suggestion: 'Replace `x / N` with `x >> k` where N = 2^k for cheaper bit-shift arithmetic.',
  },
  {
    id: 'repeated-arithmetic-in-loop',
    description: 'Arithmetic expression repeated inside a loop',
    pattern: /\b(for|while|loop)\b[\s\S]{0,300}?(\w+\s*[+\-*\/]\s*\w+)[\s\S]{0,100}?\2/,
    severity: 'medium',
    suggestion: 'Hoist repeated arithmetic outside the loop to avoid redundant computation.',
  },
  {
    id: 'checked-vs-wrapping',
    description: 'Unchecked arithmetic that may silently overflow',
    pattern: /\b(\w+)\s*\+\s*(\w+)\b(?!\s*\.checked_add|\s*\.wrapping_add|\s*\.saturating_add)/,
    severity: 'medium',
    suggestion: 'Use `.checked_add()`, `.saturating_add()`, or `.wrapping_add()` to make overflow behaviour explicit.',
  },
];

export function analyzeIntegerOperations(source: string): IntegerOperationReport {
  const findings: ArithmeticFinding[] = [];
  const lines = source.split('\n');

  for (const ap of ARITHMETIC_PATTERNS) {
    const isMultiLine = ap.id === 'repeated-arithmetic-in-loop';

    if (isMultiLine) {
      const re = new RegExp(ap.pattern.source, 'gs');
      let match: RegExpExecArray | null;
      while ((match = re.exec(source)) !== null) {
        const line = source.slice(0, match.index).split('\n').length;
        findings.push({
          ruleId: `soroban-arithmetic-${ap.id}`,
          severity: ap.severity,
          line,
          message: `${ap.description} detected.`,
          suggestion: ap.suggestion,
          patternId: ap.id,
        });
      }
    } else {
      for (let i = 0; i < lines.length; i++) {
        if (ap.pattern.test(lines[i])) {
          findings.push({
            ruleId: `soroban-arithmetic-${ap.id}`,
            severity: ap.severity,
            line: i + 1,
            message: `${ap.description} at line ${i + 1}.`,
            suggestion: ap.suggestion,
            patternId: ap.id,
          });
        }
      }
    }
  }

  const summary = findings.length > 0
    ? `${findings.length} arithmetic optimization opportunity(ies) found.`
    : 'No avoidable arithmetic patterns detected.';

  return { findings, summary };
}
