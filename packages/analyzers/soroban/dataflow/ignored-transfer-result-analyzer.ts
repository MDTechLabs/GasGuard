/**
 * Issue #923 — Ignored Token Transfer Result Analyzer
 *
 * Detects code that assumes token transfers always succeed: a transfer call
 * whose outcome is never observed.
 *
 * Two shapes are detected:
 *
 * 1. **Ignored `try_` result** — `client.try_transfer(..)` returns a
 *    `Result`. When the value is discarded (statement-position call, no
 *    `?`, no `match`, no `unwrap`/`expect`, no assignment) the caller has
 *    no idea whether the transfer happened, so downstream state may be
 *    built on an assumption instead of a checked outcome.
 * 2. **Unobserved transfer outcome** — a transfer whose result is captured
 *    into a variable that is never read afterwards.
 *
 * Transfer calls are tracked through the shared `resolveTokenBindings`
 * helper so `client.transfer(..)` calls are attributed to the token they
 * were built from.
 */

import {
  createLineResolver,
  extractArgs,
  extractFunctions,
  maskNonCode,
  normalizeExpr,
  receiverBefore,
  resolveTokenBindings,
  resolveTokenFromReceiver,
  splitArgs,
} from '../common/source-utils';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface TransferCallSite {
  fn: string;
  asset: string;
  /** `transfer` / `transfer_from` (optionally `try_`-prefixed). */
  method: string;
  /** True for `try_` variants returning a `Result`. */
  isTry: boolean;
  /** True when the call's result is assigned to a variable. */
  resultCaptured: boolean;
  /** Name of the variable the result was captured into, if any. */
  resultVar?: string;
  /** Normalized fingerprint of the call arguments. */
  argsFingerprint: string;
  line: number;
  offset: number;
  /** Offset just past the enclosing function body. */
  fnBodyEnd: number;
  /** Trimmed first line of the call expression (checked for `?`/unwrap). */
  callHead: string;
}

export interface IgnoredTransferResultFinding {
  ruleId: 'soroban-ignored-transfer-result';
  severity: Severity;
  line: number;
  fn: string;
  asset: string;
  method: string;
  message: string;
  suggestion: string;
}

export interface IgnoredTransferResultReport {
  sites: TransferCallSite[];
  findings: IgnoredTransferResultFinding[];
  metrics: {
    transferCalls: number;
    ignoredOutcomes: number;
  };
}

/**
 * Detect every token transfer call site with result-tracking metadata.
 */
export function extractTransferCallSites(source: string): TransferCallSite[] {
  const masked = maskNonCode(source);
  const lineOf = createLineResolver(source);
  const bindings = resolveTokenBindings(masked, source);
  const functions = extractFunctions(masked, source);
  const sites: TransferCallSite[] = [];

  const scan = (pattern: RegExp, isTry: boolean): void => {
    const re = new RegExp(pattern.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked)) !== null) {
      const enclosing = functions.find(
        (f) => m.index >= f.bodyStart && m.index < f.bodyEnd,
      );
      if (!enclosing) continue;

      const receiver = receiverBefore(source, m.index);
      if (receiver === '' || /^(env|self|storage)/.test(receiver)) continue;
      const asset = resolveTokenFromReceiver(receiver, bindings);

      const openParen = m.index + m[0].length - 1;
      const method = (isTry ? 'try_' : '') + m[1];
      const rawArgs = splitArgs(extractArgs(masked, source, openParen).text);

      // Result captured into a variable: `let x = client.transfer(..)`.
      const prefix = masked.slice(Math.max(enclosing.bodyStart, m.index - 120), m.index);
      const letMatch = prefix.match(/(?:\n|^)\s*let\s+(?:mut\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?::[^=]+)?=\s*$/);
      const resultCaptured = Boolean(letMatch);
      const resultVar = letMatch?.[1];

      // Head of the call statement, used for inline-handling checks.
      const callHead = source.slice(m.index, enclosing.bodyEnd).split('\n')[0].trim();

      sites.push({
        fn: enclosing.name,
        asset,
        method,
        isTry,
        resultCaptured,
        resultVar,
        argsFingerprint: rawArgs.map(normalizeExpr).join(','),
        line: lineOf(m.index),
        offset: m.index,
        fnBodyEnd: enclosing.bodyEnd,
        callHead,
      });
    }
  };

  scan(/\.try_(transfer_from|transfer)\s*\(/g, true);
  scan(/\.transfer(_from)?\s*\(/g, false);

  return sites.sort((a, b) => a.offset - b.offset);
}

/** True when the call result is consumed inline (`?`, unwrap, expect). */
function isHandledInline(callHead: string): boolean {
  return /\?\s*;?$/.test(callHead) || /\.unwrap\(\)|\.expect\(/.test(callHead);
}

/**
 * Find transfers whose outcome is ignored.
 */
export function findIgnoredTransferResults(source: string): IgnoredTransferResultFinding[] {
  const masked = maskNonCode(source);
  const sites = extractTransferCallSites(source);
  const findings: IgnoredTransferResultFinding[] = [];

  for (const site of sites) {
    let ignored = false;

    if (site.isTry && !site.resultCaptured && !isHandledInline(site.callHead)) {
      // `try_` variant whose Result is fully discarded.
      ignored = true;
    } else if (site.resultCaptured && site.resultVar !== undefined) {
      // Captured but never read again within the enclosing function.
      const rest = masked.slice(site.offset, site.fnBodyEnd);
      if (!new RegExp(`\\b${site.resultVar}\\b`).test(rest)) {
        ignored = true;
      }
    }

    if (!ignored) continue;

    findings.push({
      ruleId: 'soroban-ignored-transfer-result',
      severity: site.isTry ? 'high' : 'medium',
      line: site.line,
      fn: site.fn,
      asset: site.asset,
      method: site.method,
      message: site.isTry
        ? `Ignored transfer outcome: '${site.method}' on '${site.asset}' at line ${site.line} returns a Result that is never observed — downstream state may assume a transfer that failed.`
        : `Transfer outcome of '${site.method}' on '${site.asset}' at line ${site.line} is captured into '${site.resultVar}' but never observed before advancing state.`,
      suggestion: site.isTry
        ? "Handle the `try_` call's Result (match on it, propagate with `?`, or unwrap_or_panic) before mutating further state."
        : 'Observe the transfer result before advancing contract state, or use the `try_` variant and handle its Result.',
    });
  }

  return findings.sort((a, b) => a.line - b.line);
}

/**
 * Full report for issue #923.
 */
export function analyzeIgnoredTransferResults(source: string): IgnoredTransferResultReport {
  const sites = extractTransferCallSites(source);
  const findings = findIgnoredTransferResults(source);

  return {
    sites,
    findings,
    metrics: {
      transferCalls: sites.length,
      ignoredOutcomes: findings.length,
    },
  };
}
