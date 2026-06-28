/**
 * Detect Unsafe Operations in Soroban Contracts (#496)
 * Flags patterns that may introduce security vulnerabilities or unexpected behaviour
 * in Soroban smart contracts written in Rust.
 */

export interface UnsafeOperationViolation {
  type: string;
  line: number;
  description: string;
  recommendation: string;
}

export interface UnsafeOperationsResult {
  detected: boolean;
  violations: UnsafeOperationViolation[];
  message: string;
  suggestion: string;
}

interface UnsafePattern {
  type: string;
  pattern: RegExp;
  description: string;
  recommendation: string;
}

const UNSAFE_PATTERNS: UnsafePattern[] = [
  {
    type: 'unsafe-block',
    pattern: /\bunsafe\s*\{/,
    description: 'Use of `unsafe` block bypasses Rust safety guarantees.',
    recommendation:
      'Avoid `unsafe` blocks in Soroban contracts. If absolutely necessary, isolate the unsafe code behind a well-tested, audited helper with clear pre/post-conditions.',
  },
  {
    type: 'unsafe-function',
    pattern: /\bunsafe\s+fn\s+\w+/,
    description: 'Declaration of an `unsafe fn` exposes callers to undefined behaviour if misused.',
    recommendation:
      'Prefer safe function signatures. If the function must be unsafe, document the safety contract and ensure all callers uphold it.',
  },
  {
    type: 'unchecked-unwrap',
    pattern: /\.unwrap\(\)/,
    description: '`.unwrap()` will panic on `None` or `Err`, crashing the contract.',
    recommendation:
      'Replace `.unwrap()` with `.unwrap_or()`, `.unwrap_or_else()`, `?` operator, or explicit `match` to handle failure gracefully.',
  },
  {
    type: 'panic-macro',
    pattern: /\bpanic!\s*\(/,
    description: '`panic!()` aborts execution and consumes all remaining gas.',
    recommendation:
      'Return a `Result` with a descriptive error instead of panicking so callers can react appropriately.',
  },
  {
    type: 'unreachable-macro',
    pattern: /\bunreachable!\s*\(/,
    description: '`unreachable!()` panics if the code path is ever reached.',
    recommendation:
      'Return an explicit error via `Result` or use `debug_assert!` during development only.',
  },
  {
    type: 'transmute',
    pattern: /\bstd::mem::transmute\b|\bmem::transmute\b|\btransmute\s*</,
    description: '`transmute` performs unchecked type reinterpretation and can violate memory safety.',
    recommendation:
      'Use safe conversion traits (`From`, `TryFrom`, `Into`) or Soroban SDK conversion helpers instead.',
  },
  {
    type: 'raw-pointer',
    pattern: /\*\s*const\s+\w+|\*\s*mut\s+\w+/,
    description: 'Raw pointers bypass Rust borrow-checker guarantees.',
    recommendation:
      'Use references (`&T`, `&mut T`) or Soroban SDK types. Raw pointers are rarely needed in contract code.',
  },
  {
    type: 'unchecked-arithmetic',
    pattern: /[^\w](?:checked_add|checked_sub|checked_mul|checked_div|saturating_add|saturating_sub|saturating_mul|wrapping_add|wrapping_sub|wrapping_mul)\(/,
    description: 'Arithmetic uses checked/saturating/wrapping helpers but may still need explicit overflow handling.',
    recommendation:
      'Verify that the chosen overflow strategy (checked, saturating, wrapping) matches the business requirement. Prefer `checked_*` with proper error propagation.',
  },
];

/**
 * Returns the 1-based line number for the start of `match` within `code`.
 */
function lineNumber(code: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (code[i] === '\n') line++;
  }
  return line;
}

export function detectUnsafeOperations(code: string): UnsafeOperationsResult {
  const violations: UnsafeOperationViolation[] = [];

  for (const { type, pattern, description, recommendation } of UNSAFE_PATTERNS) {
    // Use a fresh regex with global flag for iteration
    const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
    let match: RegExpExecArray | null;
    while ((match = re.exec(code)) !== null) {
      violations.push({
        type,
        line: lineNumber(code, match.index),
        description,
        recommendation,
      });
      // Prevent infinite loops on zero-length matches
      if (match[0].length === 0) re.lastIndex++;
    }
  }

  // Also detect raw unchecked arithmetic operators (a + b, a - b, a * b)
  // outside of checked/saturating/wrapping helpers.
  const rawArithRe = /\b\w+\s*(?:\+|-|\*)\s*\w+/g;
  const safeArithRe =
    /\b(?:checked_add|checked_sub|checked_mul|checked_div|saturating_add|saturating_sub|saturating_mul|wrapping_add|wrapping_sub|wrapping_mul)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = rawArithRe.exec(code)) !== null) {
    // Skip if inside a line that already uses a safe helper
    const lineStart = code.lastIndexOf('\n', m.index) + 1;
    const lineEnd = code.indexOf('\n', m.index + m[0].length);
    const lineContent = code.slice(lineStart, lineEnd === -1 ? code.length : lineEnd);
    if (safeArithRe.test(lineContent)) {
      safeArithRe.lastIndex = 0;
      continue;
    }
    safeArithRe.lastIndex = 0;

    // Skip common non-arithmetic contexts (imports, string literals, comments)
    if (/^\s*\/\//.test(lineContent) || /^\s*\/\*/.test(lineContent) || /^\s*use\s+/.test(lineContent)) {
      continue;
    }

    // Skip if inside a string literal
    if (/["'].*[+\-*].*["']/.test(lineContent)) {
      continue;
    }

    violations.push({
      type: 'unchecked-arithmetic-operator',
      line: lineNumber(code, m.index),
      description:
        'Raw arithmetic operator (`+`, `-`, `*`) may silently overflow or underflow in production.',
      recommendation:
        'Use `.checked_add()`, `.checked_sub()`, `.checked_mul()` with proper error handling, or `.saturating_*()` / `.wrapping_*()` when the overflow semantics are intentional.',
    });
  }

  if (violations.length === 0) {
    return {
      detected: false,
      violations: [],
      message: 'No unsafe operations detected.',
      suggestion: '',
    };
  }

  const uniqueTypes = [...new Set(violations.map((v) => v.type))];

  return {
    detected: true,
    violations,
    message: `Detected ${violations.length} unsafe operation(s): ${uniqueTypes.join(', ')}.`,
    suggestion:
      'Review each flagged operation and replace with safe alternatives. Prefer explicit error handling over panics and use Soroban SDK helpers for arithmetic and type conversions.',
  };
}
