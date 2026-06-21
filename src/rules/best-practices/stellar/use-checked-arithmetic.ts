export interface CheckedArithmeticResult {
  detected: boolean;
  violations: Array<{
    operator: string;
    snippet: string;
    suggestion: string;
  }>;
  message: string;
  suggestion: string;
}

const OVERFLOW_OPS = [
  { pattern: /(\w+)\s*\+\s*(\w+)/g, op: '+', suggestion: 'Use checked_add() for overflow-safe addition' },
  { pattern: /(\w+)\s*-\s*(\w+)/g, op: '-', suggestion: 'Use checked_sub() for overflow-safe subtraction' },
  { pattern: /(\w+)\s*\*\s*(\w+)/g, op: '*', suggestion: 'Use checked_mul() for overflow-safe multiplication' },
  { pattern: /(\w+)\s*\/\s*(\w+)/g, op: '/', suggestion: 'Use checked_div() for overflow-safe division' },
];

const ALREADY_SAFE = /checked_add|checked_sub|checked_mul|checked_div|overflow|saturating_|wrapping_/;

const RESULT_CONTEXT = /Result|unwrap_or|unwrap_or_else|match/;

export function detectUncheckedArithmetic(code: string): CheckedArithmeticResult {
  const violations: CheckedArithmeticResult['violations'] = [];

  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (ALREADY_SAFE.test(line)) continue;
    if (RESULT_CONTEXT.test(line)) continue;

    for (const opDef of OVERFLOW_OPS) {
      const matches = line.matchAll(opDef.pattern);
      for (const match of matches) {
        const lhs = match[1];
        const rhs = match[2];

        if (/^['"&]/.test(lhs) || /^['"&]/.test(rhs)) continue;
        if (/String|Vec|Map|Bytes/.test(lhs) || /String|Vec|Map|Bytes/.test(rhs)) continue;
        if (lhs === 'i' || lhs === 'j' || lhs === 'idx' || lhs === 'index') continue;

        violations.push({
          operator: opDef.op,
          snippet: match[0].slice(0, 60),
          suggestion: opDef.suggestion,
        });
      }
    }
  }

  if (violations.length === 0) {
    return {
      detected: false,
      violations: [],
      message: 'No unchecked arithmetic operations detected.',
      suggestion: '',
    };
  }

  return {
    detected: true,
    violations,
    message: `${violations.length} unchecked arithmetic operation(s) detected.`,
    suggestion: 'Use checked_add(), checked_sub(), checked_mul(), or checked_div() from the soroban_sdk to prevent overflow panics.',
  };
}
