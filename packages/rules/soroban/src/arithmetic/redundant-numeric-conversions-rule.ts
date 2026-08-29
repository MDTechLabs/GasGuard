/**
 * Issue #800 — Detect Redundant Numeric Conversions in Soroban
 *
 * Detects repeated or unnecessary numeric type conversions/casts that
 * add computation without changing the value semantics.
 */

export type Severity = 'high' | 'medium' | 'low' | 'info';

export interface ConversionFinding {
  ruleId: string;
  severity: Severity;
  line: number;
  message: string;
  suggestion: string;
  patternId: string;
}

export interface ConversionReport {
  findings: ConversionFinding[];
  summary: string;
}

interface ConversionPattern {
  id: string;
  description: string;
  pattern: RegExp;
  severity: Severity;
  suggestion: string;
}

const CONVERSION_PATTERNS: ConversionPattern[] = [
  {
    id: 'double-as-cast',
    description: 'Value cast twice via `as` (round-trip cast)',
    pattern: /\bас\s+\w+\s+as\s+\w+|\w+\s+as\s+\w+\s+as\s+\w+/,
    severity: 'medium',
    suggestion: 'Collapse chained `as` casts into a single direct cast to the final type.',
  },
  {
    id: 'i128-to-u128-back',
    description: 'i128 → u128 → i128 round-trip',
    pattern: /as\s+u128[^;]*as\s+i128|as\s+i128[^;]*as\s+u128/,
    severity: 'medium',
    suggestion: 'Avoid round-tripping between i128 and u128; operate in a single type throughout.',
  },
  {
    id: 'u32-i64-round-trip',
    description: 'u32 → i64 → u32 round-trip',
    pattern: /as\s+i64[^;]*as\s+u32|as\s+u32[^;]*as\s+i64/,
    severity: 'low',
    suggestion: 'Avoid widening then narrowing casts; keep the value in its original type where possible.',
  },
  {
    id: 'into-into-chain',
    description: 'Chained .into().into() calls',
    pattern: /\.into\(\)\.into\(\)/,
    severity: 'low',
    suggestion: 'Replace `.into().into()` with a single direct `.into()` or an explicit `Type::from()` call.',
  },
  {
    id: 'from-into-identity',
    description: 'Type::from(x) where x is already the target type',
    pattern: /(\w+)::from\s*\(\s*\1\s*\)/,
    severity: 'low',
    suggestion: 'Remove the no-op `T::from(t)` where t is already of type T.',
  },
  {
    id: 'unnecessary-i32-widening',
    description: 'Unnecessary widening from i32 to i128 for simple arithmetic',
    pattern: /\bas\s+i32\b[^;]*as\s+i128\b/,
    severity: 'low',
    suggestion: 'Use i128 directly for Soroban amounts; avoid narrowing to i32 then widening back.',
  },
];

export function detectRedundantConversions(source: string): ConversionReport {
  const findings: ConversionFinding[] = [];
  const lines = source.split('\n');

  for (const cp of CONVERSION_PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      if (cp.pattern.test(lines[i])) {
        findings.push({
          ruleId: `soroban-conversion-${cp.id}`,
          severity: cp.severity,
          line: i + 1,
          message: `${cp.description} at line ${i + 1}.`,
          suggestion: cp.suggestion,
          patternId: cp.id,
        });
      }
    }
  }

  const summary = findings.length > 0
    ? `${findings.length} redundant numeric conversion(s) detected.`
    : 'No redundant numeric conversions detected.';

  return { findings, summary };
}
