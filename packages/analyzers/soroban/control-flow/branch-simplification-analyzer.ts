/**
 * Issue #798 — Soroban Branch Simplification Analyzer
 *
 * Detects redundant conditional logic in Soroban (Rust) contract source:
 * constant conditions, duplicate branches, and unnecessary conditions.
 * Generates safe simplification suggestions.
 */

export type Severity = 'high' | 'medium' | 'low' | 'info';

export interface BranchPattern {
  id: string;
  description: string;
  pattern: RegExp;
  severity: Severity;
  suggestion: string;
}

export interface BranchFinding {
  ruleId: string;
  severity: Severity;
  line: number;
  message: string;
  suggestion: string;
  patternId: string;
}

export interface BranchSimplificationReport {
  findings: BranchFinding[];
  totalRedundantBranches: number;
  summary: string;
}

const BRANCH_PATTERNS: BranchPattern[] = [
  {
    id: 'constant-true-condition',
    description: 'Condition always evaluates to true',
    pattern: /if\s+true\s*\{/,
    severity: 'medium',
    suggestion: 'Remove the `if true` guard — the branch body always executes.',
  },
  {
    id: 'constant-false-condition',
    description: 'Condition always evaluates to false',
    pattern: /if\s+false\s*\{/,
    severity: 'medium',
    suggestion: 'Remove the `if false` block — it is dead code and never executes.',
  },
  {
    id: 'double-negation',
    description: 'Double boolean negation (!!x)',
    pattern: /!!\s*\w+/,
    severity: 'low',
    suggestion: 'Simplify `!!x` to `x` — double negation is a no-op.',
  },
  {
    id: 'tautological-comparison',
    description: 'Tautological comparison (x == x or x != x)',
    pattern: /\b(\w+)\s*==\s*\1\b|\b(\w+)\s*!=\s*\2\b/,
    severity: 'medium',
    suggestion: 'Remove tautological comparisons; they are always true/false.',
  },
  {
    id: 'redundant-else-after-return',
    description: 'Else clause after an if block that always returns',
    pattern: /if\s+[^{]+\{[^}]*\breturn\b[^}]*\}\s*else\s*\{/,
    severity: 'low',
    suggestion: 'Remove the `else` — the preceding `if` always returns, making `else` unnecessary.',
  },
  {
    id: 'empty-if-block',
    description: 'Empty if block body',
    pattern: /if\s+[^{]+\{\s*\}/,
    severity: 'low',
    suggestion: 'Remove or populate the empty `if` block.',
  },
  {
    id: 'negated-equality',
    description: 'Negated equality that can use != directly',
    pattern: /!\s*\(\s*\w+\s*==\s*\w+\s*\)/,
    severity: 'low',
    suggestion: 'Replace `!(a == b)` with `a != b` for clarity.',
  },
];

export function analyzeBranchSimplification(
  source: string,
): BranchSimplificationReport {
  const findings: BranchFinding[] = [];
  const lines = source.split('\n');

  for (const bp of BRANCH_PATTERNS) {
    const isMultiLine =
      bp.id === 'redundant-else-after-return';

    if (isMultiLine) {
      const re = new RegExp(bp.pattern.source, 'gs');
      let match: RegExpExecArray | null;
      while ((match = re.exec(source)) !== null) {
        const line = source.slice(0, match.index).split('\n').length;
        findings.push(makeFinding(bp, line));
      }
    } else {
      for (let i = 0; i < lines.length; i++) {
        if (bp.pattern.test(lines[i])) {
          findings.push(makeFinding(bp, i + 1));
        }
      }
    }
  }

  const summary = findings.length > 0
    ? `${findings.length} redundant branch pattern(s) detected. Simplifying these reduces execution complexity.`
    : 'No redundant branch patterns detected.';

  return { findings, totalRedundantBranches: findings.length, summary };
}

function makeFinding(bp: BranchPattern, line: number): BranchFinding {
  return {
    ruleId: `soroban-branch-${bp.id}`,
    severity: bp.severity,
    line,
    message: `${bp.description} at line ${line}.`,
    suggestion: bp.suggestion,
    patternId: bp.id,
  };
}
