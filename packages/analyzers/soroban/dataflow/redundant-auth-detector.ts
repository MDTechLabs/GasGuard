/**
 * Issue #896 — Detect Unnecessary Soroban Authentication Checks
 *
 * Tracks authentication state, detects redundant checks in the same execution context,
 * analyzes execution paths, and generates safe consolidation suggestions.
 */

import {
  maskNonCode,
  extractFunctions,
  blockStackAt,
  onExclusiveBranches,
  isInLoop,
} from '../common/source-utils';

export interface RedundantAuthCheck {
  target: string;
  firstLine: number;
  redundantLine: number;
  caller: string;
  inLoop: boolean;
  canConsolidate: boolean;
}

export interface RedundantAuthFinding {
  ruleId: 'soroban-redundant-auth';
  severity: 'high' | 'medium';
  line: number;
  message: string;
  suggestion: string;
  target: string;
}

export interface RedundantAuthReport {
  redundantChecks: RedundantAuthCheck[];
  findings: RedundantAuthFinding[];
  metrics: {
    totalRedundantChecks: number;
    loopEmbeddedChecks: number;
  };
}

const AUTH_CALL_RE = /(\b[A-Za-z_][A-Za-z0-9_]*\s*\.)?(require_auth_for_args|require_auth)\s*\(/g;

export function detectRedundantAuth(source: string): RedundantAuthReport {
  const masked = maskNonCode(source);
  const functions = extractFunctions(masked, source);
  const redundantChecks: RedundantAuthCheck[] = [];
  const findings: RedundantAuthFinding[] = [];

  let loopEmbeddedChecks = 0;

  for (const fn of functions) {
    const fnBodyMasked = masked.slice(fn.bodyStart, fn.bodyEnd);

    AUTH_CALL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;

    interface Site {
      target: string;
      offset: number;
      line: number;
      stack: ReturnType<typeof blockStackAt>;
    }

    const sites: Site[] = [];

    while ((m = AUTH_CALL_RE.exec(fnBodyMasked)) !== null) {
      const matchOffset = fn.bodyStart + m.index;
      const stack = blockStackAt(masked, fn.bodyStart, matchOffset);
      const target = m[1] ? m[1].replace('.', '').trim() : 'self';
      const line = source.slice(0, matchOffset).split('\n').length;

      sites.push({ target, offset: matchOffset, line, stack });
    }

    for (let i = 0; i < sites.length; i++) {
      for (let j = i + 1; j < sites.length; j++) {
        const first = sites[i];
        const second = sites[j];

        if (first.target === second.target) {
          const exclusive = onExclusiveBranches(first.stack, second.stack);
          const loop = isInLoop(second.stack);

          if (!exclusive) {
            if (loop) loopEmbeddedChecks++;

            const item: RedundantAuthCheck = {
              target: first.target,
              firstLine: first.line,
              redundantLine: second.line,
              caller: fn.name,
              inLoop: loop,
              canConsolidate: !exclusive,
            };

            redundantChecks.push(item);

            findings.push({
              ruleId: 'soroban-redundant-auth',
              severity: loop ? 'high' : 'medium',
              line: second.line,
              message: `Unnecessary redundant require_auth() check on '${first.target}' at line ${second.line} (previously verified at line ${first.line}).`,
              suggestion: loop
                ? `Remove require_auth() from inside the loop and execute it once before loop entry.`
                : `Consolidate redundant require_auth() check into a single check at function entry.`,
              target: first.target,
            });
          }
        }
      }
    }
  }

  return {
    redundantChecks,
    findings,
    metrics: {
      totalRedundantChecks: redundantChecks.length,
      loopEmbeddedChecks,
    },
  };
}
