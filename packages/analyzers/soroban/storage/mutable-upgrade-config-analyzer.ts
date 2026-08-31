/**
 * Issue #926 — Detect Mutable Soroban Upgrade Configuration (storage analyzer)
 *
 * Identifies upgrade configuration stored in contract ledger state — the keys
 * that record what the contract may be upgraded to (wasm hashes, implementation
 * addresses, upgrade targets) — and tracks every write to those keys, reporting
 * mutation paths that are not protected by an authorization check.
 *
 * Attackers who can mutate upgrade configuration without authentication can
 * redirect a future upgrade to a malicious implementation, so unsafe mutation
 * paths are reported as security findings, not just housekeeping.
 */

import {
  maskNonCode,
  createLineResolver,
  extractFunctions,
  extractArgs,
  splitArgs,
} from '../common/source-utils';

export type MutableConfigSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/** A single tracked write to an upgrade-configuration key. */
export interface MutableUpgradeConfigWrite {
  fn: string;
  key: string;
  scope: 'instance' | 'persistent' | 'temporary' | 'unknown';
  line: number;
  hasAuthorization: boolean;
  authorizedBy?: string;
}

export interface MutableUpgradeConfigFinding {
  ruleId: string;
  severity: MutableConfigSeverity;
  title: string;
  functionName: string;
  key: string;
  line: number;
  hasAuthorization: boolean;
  message: string;
  suggestion: string;
}

export interface MutableUpgradeConfigReport {
  findings: MutableUpgradeConfigFinding[];
  writes: MutableUpgradeConfigWrite[];
  unsafeWriteCount: number;
  totalWriteCount: number;
  recommendations: string[];
}

/** Storage scopes that can carry upgrade configuration. */
const STORAGE_SCOPE_REGEX = /\bstorage\s*\(\s*\)\s*\.\s*(instance|persistent|temporary)\s*\(\s*\)\s*\.\s*(set|put)\s*\(/g;

/**
 * Upgrade-configuration key heuristic. Matches keys that plausibly store what
 * a contract may be upgraded to, delimited so `code` or `upgrade` are not
 * matched as substrings of unrelated keys.
 */
const UPGRADE_CONFIG_KEY =
  /(^|_)(upgrade|wasm|code|implementation|impl|target|next_hash|new_code|bytecode)(_|$)/i;

/** Access-control primitives that would protect a configuration write. */
const ACCESS_CONTROL =
  /require_auth\s*\(|require_auth_for_args\s*\(|\b(admin|owner|admin_owner|governor|controller)\s*\.\s*require_auth\s*\(|\bonly_admin\s*\(|assert_admin\s*\(|check_admin\s*\(|ensure_admin\s*\(/;

function findAuthorization(body: string): { has: boolean; by?: string } {
  const m = ACCESS_CONTROL.exec(body);
  return m
    ? { has: true, by: m[0] }
    : { has: false };
}

/** Resolve a storage-key argument to a readable key name. */
function resolveStorageKey(raw: string): string {
  const trimmed = raw.trim().replace(/^[&*]+/, '');
  const literal = trimmed.match(/"((?:[^"\\]|\\.)*)"/);
  return literal ? literal[1] : trimmed;
}

/**
 * Track every write to an upgrade-configuration key, tagged with whether the
 * enclosing function carries an authorization check.
 */
export function detectMutableUpgradeConfigWrites(
  source: string,
): MutableUpgradeConfigWrite[] {
  const masked = maskNonCode(source);
  const lineOf = createLineResolver(source);
  const functions = extractFunctions(masked, source);
  const writes: MutableUpgradeConfigWrite[] = [];

  for (const fn of functions) {
    const body = masked.slice(fn.bodyStart, fn.bodyEnd);
    const auth = findAuthorization(body);

    let m: RegExpExecArray | null;
    STORAGE_SCOPE_REGEX.lastIndex = 0;
    while ((m = STORAGE_SCOPE_REGEX.exec(body)) !== null) {
      const scope = m[1] as MutableUpgradeConfigWrite['scope'];
      const offset = fn.bodyStart + m.index;
      const openParen = offset + m[0].length - 1;
      const argsText = extractArgs(masked, source, openParen).text;
      const args = splitArgs(argsText);
      const key = args.length > 0 ? resolveStorageKey(args[0]) : 'unknown';

      if (!UPGRADE_CONFIG_KEY.test(key)) continue;

      writes.push({
        fn: fn.name,
        key,
        scope,
        line: lineOf(offset),
        hasAuthorization: auth.has,
        authorizedBy: auth.by,
      });
    }
  }

  return writes.sort((a, b) => a.line - b.line);
}

/**
 * Analyze mutation paths for upgrade configuration in a Soroban contract.
 */
export function analyzeMutableUpgradeConfig(source: string): MutableUpgradeConfigReport {
  const writes = detectMutableUpgradeConfigWrites(source);
  const findings: MutableUpgradeConfigFinding[] = [];
  const seen = new Set<string>();

  for (const w of writes) {
    const dedupeKey = `${w.fn}:${w.line}:${w.key}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    if (!w.hasAuthorization) {
      findings.push({
        ruleId: 'soroban-mutable-upgrade-config',
        severity: 'high',
        title: 'Unauthorized mutation of upgrade configuration',
        functionName: w.fn,
        key: w.key,
        line: w.line,
        hasAuthorization: false,
        message:
          `Function '${w.fn}' writes upgrade configuration key '${w.key}' (${w.scope} ` +
          `storage) without an authorization check, so anyone can redirect future upgrades.`,
        suggestion:
          `Guard '${w.fn}' with \`admin.require_auth()\` and consider restricting which ` +
          `callers may write the key, e.g. via a dedicated admin-only setter plus an event.`,
      });
    }
  }

  const unsafeWriteCount = writes.filter((w) => !w.hasAuthorization).length;

  const recommendations: string[] = [];
  if (unsafeWriteCount > 0) {
    recommendations.push(
      `${unsafeWriteCount} write(s) to upgrade configuration are unauthenticated. ` +
        'Require an authorized admin for every path that can change the upgrade target.',
    );
  }
  if (writes.length > 0) {
    recommendations.push(
      'Emit a contract event with the previous and new upgrade configuration on every write, and track the writer address.',
    );
  }

  return {
    findings: findings.sort((a, b) => a.line - b.line),
    writes,
    unsafeWriteCount,
    totalWriteCount: writes.length,
    recommendations,
  };
}

export class MutableUpgradeConfigAnalyzer {
  public static readonly RULE_ID = 'soroban-mutable-upgrade-config';

  analyze(source: string): MutableUpgradeConfigReport {
    return analyzeMutableUpgradeConfig(source);
  }
}