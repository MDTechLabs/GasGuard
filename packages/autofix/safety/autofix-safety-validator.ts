/**
 * Issue #804 — Soroban Auto-Fix Safety Validator
 *
 * Validates proposed fix instructions before application:
 * - Checks fix scope is within file bounds
 * - Detects conflicting (overlapping) edits
 * - Validates AST integrity (structural keyword preservation)
 * - Rejects unsafe transformations
 */

import { FixInstruction } from '../diff/optimization-diff-generator';

export type ValidationStatus = 'safe' | 'rejected' | 'warning';

export interface ValidationResult {
  status: ValidationStatus;
  fix: FixInstruction;
  reason?: string;
}

export interface SafetyReport {
  allSafe: boolean;
  results: ValidationResult[];
  rejectedCount: number;
  safeCount: number;
}

const UNSAFE_REMOVAL_PATTERNS = [
  /\bpub\s+fn\b/,
  /\b#\[contractimpl\]/,
  /\b#\[contract\]/,
  /\bimpl\b.*\{/,
];

/**
 * Validate a set of fix instructions against the source.
 * Returns a report indicating which fixes are safe to apply.
 */
export function validateFixes(
  source: string,
  fixes: FixInstruction[],
): SafetyReport {
  const lines = source.split('\n');
  const results: ValidationResult[] = [];

  for (const fix of fixes) {
    const result = validateSingleFix(fix, lines, fixes);
    results.push(result);
  }

  return {
    allSafe: results.every((r) => r.status === 'safe'),
    results,
    rejectedCount: results.filter((r) => r.status === 'rejected').length,
    safeCount: results.filter((r) => r.status === 'safe').length,
  };
}

function validateSingleFix(
  fix: FixInstruction,
  lines: string[],
  allFixes: FixInstruction[],
): ValidationResult {
  // 1. Scope check
  if (fix.startLine < 1 || fix.endLine > lines.length || fix.startLine > fix.endLine) {
    return { status: 'rejected', fix, reason: `Fix scope [${fix.startLine}-${fix.endLine}] is out of file bounds (${lines.length} lines).` };
  }

  // 2. Overlap/conflict check
  const conflicting = allFixes.find(
    (other) =>
      other !== fix &&
      other.startLine <= fix.endLine &&
      other.endLine >= fix.startLine,
  );
  if (conflicting) {
    return { status: 'rejected', fix, reason: `Overlaps with another fix at lines ${conflicting.startLine}-${conflicting.endLine}.` };
  }

  // 3. AST integrity: reject if removing a public function or contract declaration
  const affectedLines = lines.slice(fix.startLine - 1, fix.endLine).join('\n');
  for (const pattern of UNSAFE_REMOVAL_PATTERNS) {
    if (pattern.test(affectedLines) && fix.replacement.length === 0) {
      return { status: 'rejected', fix, reason: `Removing lines ${fix.startLine}-${fix.endLine} would delete a critical contract construct.` };
    }
  }

  return { status: 'safe', fix };
}
