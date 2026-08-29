/**
 * Issue #780 — Soroban Authorization Cost Analyzer
 *
 * Analyzes authorization patterns for unnecessary resource overhead.
 * Overly complex or repeated auth checks increase execution costs.
 */

export type AuthSeverity = 'high' | 'medium' | 'low';

export interface AuthFinding {
  line: number;
  rule: string;
  severity: AuthSeverity;
  message: string;
  suggestion: string;
}

/**
 * Patterns recognized as Soroban authorization checks.
 */
const AUTH_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /require_auth\s*\(/g, label: 'require_auth' },
  { pattern: /require_auth_for_args\s*\(/g, label: 'require_auth_for_args' },
  { pattern: /invoker\s*\(\s*\)/g, label: 'invoker()' },
  { pattern: /auth\.authenticate\s*\(/g, label: 'auth.authenticate' },
];

/**
 * Detects repeated or overly complex authorization patterns in Soroban contracts.
 *
 * Rules applied:
 *  A1 — Repeated auth check: same auth call appears more than once in a function.
 *  A2 — Auth inside loop: auth check found inside a loop construct.
 *  A3 — Redundant multi-auth: both `require_auth` and `require_auth_for_args` called
 *       in the same function (the latter subsumes the former).
 */
export class SorobanAuthorizationAnalyzer {
  public static readonly RULE_ID = 'soroban-authorization-cost';

  public analyze(sourceCode: string): AuthFinding[] {
    const findings: AuthFinding[] = [];
    const lines = sourceCode.split('\n');
    const functions = this.extractFunctions(sourceCode);

    for (const fn of functions) {
      findings.push(...this.checkRepeatedAuth(fn));
      findings.push(...this.checkAuthInLoop(fn, lines));
      findings.push(...this.checkRedundantMultiAuth(fn));
    }

    return findings;
  }

  // ── rule checks ─────────────────────────────────────────────────────────────

  /** A1: Same auth call used more than once in a function body. */
  private checkRepeatedAuth(fn: FunctionBlock): AuthFinding[] {
    const findings: AuthFinding[] = [];

    for (const { pattern, label } of AUTH_PATTERNS) {
      const matches = [...fn.body.matchAll(new RegExp(pattern.source, 'g'))];
      if (matches.length <= 1) continue;

      const firstLine = fn.startLine + fn.body.slice(0, matches[0].index!).split('\n').length - 1;
      findings.push({
        line: firstLine,
        rule: 'A1-repeated-auth',
        severity: 'medium',
        message: `'${label}' is called ${matches.length} times in '${fn.name}'. Cache the auth result.`,
        suggestion:
          `Perform a single '${label}' check at the top of '${fn.name}' and ` +
          `reuse the result, or restructure to avoid repeated verification.`,
      });
    }

    return findings;
  }

  /** A2: Auth check found inside a loop — runs once per iteration unnecessarily. */
  private checkAuthInLoop(fn: FunctionBlock, _lines: string[]): AuthFinding[] {
    const findings: AuthFinding[] = [];

    // Detect loop constructs
    const loopRe = /\b(for|while|loop)\b[^{]*\{/g;
    let loopMatch: RegExpExecArray | null;

    while ((loopMatch = loopRe.exec(fn.body)) !== null) {
      const loopBody = this.extractBraceBlock(fn.body, loopMatch.index + loopMatch[0].length - 1);
      if (!loopBody) continue;

      for (const { pattern, label } of AUTH_PATTERNS) {
        if (new RegExp(pattern.source).test(loopBody)) {
          const line =
            fn.startLine + fn.body.slice(0, loopMatch.index).split('\n').length - 1;
          findings.push({
            line,
            rule: 'A2-auth-in-loop',
            severity: 'high',
            message: `'${label}' inside a loop in '${fn.name}' repeats auth overhead per iteration.`,
            suggestion:
              `Move '${label}' outside the loop in '${fn.name}' to authorize once ` +
              `before entering the loop body.`,
          });
        }
      }
    }

    return findings;
  }

  /**
   * A3: `require_auth_for_args` subsumes `require_auth` — having both is redundant.
   */
  private checkRedundantMultiAuth(fn: FunctionBlock): AuthFinding[] {
    const hasRequireAuth = /require_auth\s*\(/.test(fn.body);
    const hasRequireAuthForArgs = /require_auth_for_args\s*\(/.test(fn.body);

    if (hasRequireAuth && hasRequireAuthForArgs) {
      return [
        {
          line: fn.startLine,
          rule: 'A3-redundant-multi-auth',
          severity: 'low',
          message: `'${fn.name}' calls both 'require_auth' and 'require_auth_for_args'. The latter is a superset.`,
          suggestion:
            `Remove 'require_auth' from '${fn.name}' and keep only 'require_auth_for_args' ` +
            `to avoid the redundant cheaper check.`,
        },
      ];
    }

    return [];
  }

  // ── helpers ─────────────────────────────────────────────────────────────────

  private extractFunctions(source: string): FunctionBlock[] {
    const blocks: FunctionBlock[] = [];
    const fnHeaderRe = /\bfn\s+(\w+)\s*\([^)]*\)[^{]*\{/g;
    let match: RegExpExecArray | null;

    while ((match = fnHeaderRe.exec(source)) !== null) {
      const openPos = match.index + match[0].length - 1;
      const body = this.extractBraceBlock(source, openPos);
      if (!body) continue;

      const startLine = source.slice(0, match.index).split('\n').length;
      blocks.push({ name: match[1], body, startLine });
    }

    return blocks;
  }

  private extractBraceBlock(source: string, openPos: number): string | null {
    let depth = 0;
    for (let i = openPos; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') {
        depth--;
        if (depth === 0) return source.slice(openPos, i + 1);
      }
    }
    return null;
  }
}

interface FunctionBlock {
  name: string;
  body: string;
  startLine: number;
}
