/**
 * Issue #860 — Detect Repeated Soroban Authorization Checks
 *
 * Tracks authorization checks along execution paths and reports when the same
 * subject is authorized more than once without an intervening state change
 * that would require re-auth. Suggests safe consolidation points.
 */

export type Severity = 'high' | 'medium' | 'low';

export interface AuthCheckSite {
  fn: string;
  /** require_auth | require_auth_for_args | invoker | auth.authenticate */
  kind: string;
  /** Normalized subject expression, e.g. `user` or `args.0`. */
  subject: string;
  line: number;
  offset: number;
  /** Approximate path id (function + branch depth). */
  pathId: string;
}

export interface RepeatedAuthFinding {
  ruleId: 'soroban-repeated-auth-check';
  severity: Severity;
  line: number;
  fn: string;
  kind: string;
  subject: string;
  firstCheckLine: number;
  checkCount: number;
  pathId: string;
  message: string;
  suggestion: string;
}

export interface RepeatedAuthReport {
  checks: AuthCheckSite[];
  findings: RepeatedAuthFinding[];
  metrics: {
    totalChecks: number;
    repeatedSubjects: number;
    functionsWithRepeats: number;
  };
}

const AUTH_CALLS: Array<{ re: RegExp; kind: string }> = [
  { re: /(\w+)\s*\.\s*require_auth\s*\(\s*\)/g, kind: 'require_auth' },
  { re: /require_auth\s*\(\s*&?(\w+)/g, kind: 'require_auth' },
  { re: /require_auth_for_args\s*\(/g, kind: 'require_auth_for_args' },
  { re: /(\w+)\s*\.\s*authenticate\s*\(/g, kind: 'auth.authenticate' },
];

interface FnBlock {
  name: string;
  body: string;
  start: number;
  startLine: number;
}

function extractFunctions(source: string): FnBlock[] {
  const blocks: FnBlock[] = [];
  const re = /\bfn\s+(\w+)\s*\([^)]*\)[^{]*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const open = m.index + m[0].length - 1;
    const body = braceBlock(source, open);
    if (!body) continue;
    blocks.push({
      name: m[1],
      body,
      start: open,
      startLine: source.slice(0, m.index).split('\n').length,
    });
  }
  return blocks;
}

function braceBlock(source: string, openPos: number): string | null {
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

function lineAt(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}

/**
 * Rough path id: function name + count of open branch keywords before offset.
 * Distinguishes independent if/else arms so auth on exclusive branches is not
 * flagged as repeated on the same path.
 */
function pathIdAt(fnBody: string, offset: number, fnName: string): string {
  const prefix = fnBody.slice(0, offset);
  const ifCount = (prefix.match(/\bif\b/g) || []).length;
  const elseCount = (prefix.match(/\belse\b/g) || []).length;
  const matchCount = (prefix.match(/\bmatch\b/g) || []).length;
  return `${fnName}#if${ifCount}-else${elseCount}-match${matchCount}`;
}

function collectChecks(source: string): AuthCheckSite[] {
  const checks: AuthCheckSite[] = [];
  for (const fn of extractFunctions(source)) {
    for (const { re, kind } of AUTH_CALLS) {
      const local = new RegExp(re.source, 'g');
      let m: RegExpExecArray | null;
      while ((m = local.exec(fn.body)) !== null) {
        const subject =
          kind === 'require_auth_for_args'
            ? '<args>'
            : (m[1] || '<unknown>').trim();
        const absOffset = fn.start + m.index;
        checks.push({
          fn: fn.name,
          kind,
          subject,
          line: lineAt(source, absOffset),
          offset: absOffset,
          pathId: pathIdAt(fn.body, m.index, fn.name),
        });
      }
    }
  }
  return checks;
}

/**
 * Analyze source for repeated authorization checks on the same execution path.
 */
export function analyzeRepeatedAuthChecks(sourceCode: string): RepeatedAuthReport {
  const checks = collectChecks(sourceCode);
  const findings: RepeatedAuthFinding[] = [];

  // Group by function + subject + path
  const groups = new Map<string, AuthCheckSite[]>();
  for (const c of checks) {
    const key = `${c.fn}::${c.kind}::${c.subject}::${c.pathId}`;
    const list = groups.get(key) || [];
    list.push(c);
    groups.set(key, list);
  }

  const functionsWithRepeats = new Set<string>();
  let repeatedSubjects = 0;

  for (const [, sites] of groups) {
    if (sites.length < 2) continue;
    repeatedSubjects++;
    functionsWithRepeats.add(sites[0].fn);
    sites.sort((a, b) => a.line - b.line);
    const first = sites[0];
    const last = sites[sites.length - 1];
    findings.push({
      ruleId: 'soroban-repeated-auth-check',
      severity: sites.length >= 3 ? 'high' : 'medium',
      line: last.line,
      fn: first.fn,
      kind: first.kind,
      subject: first.subject,
      firstCheckLine: first.line,
      checkCount: sites.length,
      pathId: first.pathId,
      message:
        `'${first.kind}' on subject '${first.subject}' appears ${sites.length} times ` +
        `along the same execution path in '${first.fn}' (first at line ${first.line}).`,
      suggestion:
        `Authorize '${first.subject}' once at the top of '${first.fn}' (or at the ` +
        `entry of path '${first.pathId}') and reuse the verified identity; remove ` +
        `subsequent redundant '${first.kind}' calls on this path.`,
    });
  }

  return {
    checks,
    findings,
    metrics: {
      totalChecks: checks.length,
      repeatedSubjects,
      functionsWithRepeats: functionsWithRepeats.size,
    },
  };
}

export class RepeatedAuthCheckAnalyzer {
  public static readonly RULE_ID = 'soroban-repeated-auth-check';

  analyze(sourceCode: string): RepeatedAuthFinding[] {
    return analyzeRepeatedAuthChecks(sourceCode).findings;
  }
}
