/**
 * Analyzer: Soroban Authorization In Loops Analyzer (#874)
 *
 * Detects authorization operations executed inside loop constructs (for, while, loop),
 * analyzes loop bounds, estimates repeated cost impact, and suggests safe restructuring.
 */

export interface AuthLoopFinding {
  line: number;
  functionName: string;
  authOp: string;
  loopType: 'for' | 'while' | 'loop';
  estimatedCostMultiplier: string;
  message: string;
  suggestion: string;
  severity: 'high';
}

const AUTH_OPERATIONS = [
  { pattern: /require_auth\s*\(/, label: 'require_auth' },
  { pattern: /require_auth_for_args\s*\(/, label: 'require_auth_for_args' },
  { pattern: /verify_authorizations\s*\(/, label: 'verify_authorizations' },
  { pattern: /invoker\s*\(\s*\)/, label: 'invoker()' },
  { pattern: /auth\.authenticate\s*\(/, label: 'auth.authenticate' },
];

export class AuthorizationLoopAnalyzer {
  public analyze(sourceCode: string): AuthLoopFinding[] {
    const findings: AuthLoopFinding[] = [];
    const functions = this.extractFunctions(sourceCode);

    for (const fn of functions) {
      const loops = this.extractLoops(fn);

      for (const loop of loops) {
        for (const authOp of AUTH_OPERATIONS) {
          if (authOp.pattern.test(loop.body)) {
            const line = loop.startLine;
            findings.push({
              line,
              functionName: fn.name,
              authOp: authOp.label,
              loopType: loop.type,
              estimatedCostMultiplier: loop.isBounded ? 'O(N) CPU/Gas per iteration' : 'O(N) Unbounded Gas',
              message: `Authorization check '${authOp.label}' is executed inside a '${loop.type}' loop in '${fn.name}'. This repeats expensive authorization checks N times.`,
              suggestion: `Hoist '${authOp.label}' outside the '${loop.type}' loop in '${fn.name}' to authorize once before entering the loop iteration.`,
              severity: 'high',
            });
          }
        }
      }
    }

    return findings;
  }

  private extractFunctions(source: string): Array<{ name: string; body: string; startLine: number }> {
    const blocks: Array<{ name: string; body: string; startLine: number }> = [];
    const fnHeaderRe = /\bfn\s+([a-zA-Z0-9_]+)\s*\([^)]*\)[^{]*\{/g;
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

  private extractLoops(fn: { name: string; body: string; startLine: number }): Array<{
    type: 'for' | 'while' | 'loop';
    body: string;
    startLine: number;
    isBounded: boolean;
  }> {
    const loops: Array<{
      type: 'for' | 'while' | 'loop';
      body: string;
      startLine: number;
      isBounded: boolean;
    }> = [];

    const loopRe = /\b(for|while|loop)\b[^{]*\{/g;
    let match: RegExpExecArray | null;

    while ((match = loopRe.exec(fn.body)) !== null) {
      const loopType = match[1] as 'for' | 'while' | 'loop';
      const openPos = match.index + match[0].length - 1;
      const body = this.extractBraceBlock(fn.body, openPos);
      if (!body) continue;

      const startLine = fn.startLine + fn.body.slice(0, match.index).split('\n').length - 1;
      const isBounded = loopType === 'for' && /\b\d+\s*\.\.\s*\d+\b/.test(match[0]);

      loops.push({
        type: loopType,
        body,
        startLine,
        isBounded,
      });
    }

    return loops;
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

export function analyzeAuthorizationLoops(sourceCode: string): AuthLoopFinding[] {
  const analyzer = new AuthorizationLoopAnalyzer();
  return analyzer.analyze(sourceCode);
}
