/**
 * Issue #859 — Detect Missing Soroban Authorization Checks
 *
 * Identifies sensitive (state-changing) contract functions that lack explicit
 * authorization. Intentionally public entrypoints can be excluded via naming
 * conventions and attribute markers.
 */

export type Severity = 'high' | 'medium' | 'low';

export interface MissingAuthFinding {
  line: number;
  rule: 'M1-missing-auth';
  severity: Severity;
  functionName: string;
  message: string;
  suggestion: string;
  /** Source location hint (1-based line of fn header). */
  location: { line: number; functionName: string };
}

/** Patterns that indicate an authorization check is present. */
const AUTH_PRESENT =
  /require_auth\s*\(|require_auth_for_args\s*\(|\.authenticate\s*\(|check_auth\s*\(|assert_auth\s*\(/;

/**
 * Heuristic: function looks state-changing (writes storage, transfers, mint, etc.).
 */
const SENSITIVE_NAME =
  /\b(set|update|write|store|mint|burn|transfer|withdraw|deposit|approve|revoke|pause|unpause|upgrade|admin|init|initialize|create|delete|remove|claim|stake|unstake|execute|finalize)\w*\b/i;

const STORAGE_WRITE =
  /\.(set|extend_ttl|remove|update)\s*\(|storage\(\)\s*\.\s*(instance|persistent|temporary)\s*\(\s*\)\s*\.\s*set/;

/** Names / attributes treated as intentionally public (false-positive reduction). */
const PUBLIC_ALLOWLIST =
  /\b(get_|read_|view_|query_|list_|fetch_|is_|has_|balance_of|total_|version|name|symbol|decimals)\w*\b/i;

const PUBLIC_ATTR = /#\[(view|readonly|public|contractmeta|contractevent)/i;

interface FnBlock {
  name: string;
  header: string;
  body: string;
  startLine: number;
}

function extractFunctions(source: string): FnBlock[] {
  const blocks: FnBlock[] = [];
  const re = /\bfn\s+(\w+)\s*\(([^)]*)\)[^{]*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let end = -1;
    for (let i = open; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) continue;
    // Capture a short window before the fn for attributes
    const attrWindow = source.slice(Math.max(0, m.index - 120), m.index);
    blocks.push({
      name: m[1],
      header: attrWindow + m[0],
      body: source.slice(open, end + 1),
      startLine: source.slice(0, m.index).split('\n').length,
    });
  }
  return blocks;
}

function isSensitive(fn: FnBlock): boolean {
  if (PUBLIC_ALLOWLIST.test(fn.name)) return false;
  if (PUBLIC_ATTR.test(fn.header)) return false;
  // Skip pure test helpers
  if (/^test_/.test(fn.name)) return false;
  return SENSITIVE_NAME.test(fn.name) || STORAGE_WRITE.test(fn.body);
}

function hasAuth(fn: FnBlock): boolean {
  return AUTH_PRESENT.test(fn.body);
}

/**
 * Analyze Rust/Soroban source for sensitive functions missing authorization.
 */
export function analyzeMissingAuthorization(sourceCode: string): MissingAuthFinding[] {
  const findings: MissingAuthFinding[] = [];
  for (const fn of extractFunctions(sourceCode)) {
    if (!isSensitive(fn)) continue;
    if (hasAuth(fn)) continue;

    findings.push({
      line: fn.startLine,
      rule: 'M1-missing-auth',
      severity: 'high',
      functionName: fn.name,
      message:
        `Sensitive function '${fn.name}' performs state-changing work without an ` +
        `explicit authorization check (require_auth / require_auth_for_args).`,
      suggestion:
        `Add \`address.require_auth()\` (or \`require_auth_for_args\`) at the start of ` +
        `'${fn.name}' for every Address that authorizes the state change. If this ` +
        `entrypoint is intentionally public, rename it with a get_/view_ prefix or ` +
        `document the public-by-design exception.`,
      location: { line: fn.startLine, functionName: fn.name },
    });
  }
  return findings;
}

export class MissingAuthorizationAnalyzer {
  public static readonly RULE_ID = 'soroban-missing-authorization';

  analyze(sourceCode: string): MissingAuthFinding[] {
    return analyzeMissingAuthorization(sourceCode);
  }
}
