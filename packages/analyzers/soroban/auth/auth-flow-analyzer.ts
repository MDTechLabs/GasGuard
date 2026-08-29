/**
 * Issue #895 — Soroban Authentication Flow Analyzer
 *
 * Analyzes authentication flows across Soroban contract execution paths,
 * detects require_auth calls, tracks execution paths, identifies repeated checks,
 * and reports complex flows.
 */

import {
  maskNonCode,
  extractFunctions,
  blockStackAt,
  isInLoop,
  isInBranch,
} from '../common/source-utils';

export type AuthSeverity = 'high' | 'medium' | 'low' | 'info';

export interface AuthOperation {
  caller: string;
  line: number;
  targetAddress: string;
  method: 'require_auth' | 'require_auth_for_args';
  inLoop: boolean;
  inBranch: boolean;
}

export interface AuthFlowFinding {
  ruleId: 'soroban-auth-flow';
  severity: AuthSeverity;
  line: number;
  message: string;
  recommendation: string;
  details: {
    caller: string;
    authCount: number;
    repeatedAddresses: string[];
    isComplexFlow: boolean;
  };
}

export interface AuthFlowReport {
  operations: AuthOperation[];
  findings: AuthFlowFinding[];
  metrics: {
    totalAuthChecks: number;
    complexFlowFunctions: number;
    repeatedChecksDetected: number;
  };
}

const AUTH_RE = /(\b[A-Za-z_][A-Za-z0-9_]*\s*\.)?(require_auth_for_args|require_auth)\s*\(/g;

export function analyzeAuthFlow(source: string): AuthFlowReport {
  const masked = maskNonCode(source);
  const functions = extractFunctions(masked, source);
  const operations: AuthOperation[] = [];
  const findings: AuthFlowFinding[] = [];

  let complexFlowFunctions = 0;
  let repeatedChecksDetected = 0;

  for (const fn of functions) {
    const fnBodyMasked = masked.slice(fn.bodyStart, fn.bodyEnd);

    AUTH_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    const fnOps: AuthOperation[] = [];

    while ((m = AUTH_RE.exec(fnBodyMasked)) !== null) {
      const matchOffset = fn.bodyStart + m.index;
      const stack = blockStackAt(masked, fn.bodyStart, matchOffset);
      const prefix = m[1] ? m[1].replace('.', '').trim() : 'self';
      const method = m[2] as 'require_auth' | 'require_auth_for_args';

      const line = source.slice(0, matchOffset).split('\n').length;

      const op: AuthOperation = {
        caller: fn.name,
        line,
        targetAddress: prefix,
        method,
        inLoop: isInLoop(stack),
        inBranch: isInBranch(stack),
      };

      fnOps.push(op);
      operations.push(op);
    }

    if (fnOps.length === 0) continue;

    const addressCounts = new Map<string, number>();
    for (const op of fnOps) {
      addressCounts.set(op.targetAddress, (addressCounts.get(op.targetAddress) ?? 0) + 1);
    }

    const repeatedAddresses = Array.from(addressCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([addr]) => addr);

    if (repeatedAddresses.length > 0) {
      repeatedChecksDetected += repeatedAddresses.length;
    }

    const isComplexFlow = fnOps.length >= 3 || fnOps.some((o) => o.inLoop) || repeatedAddresses.length > 0;

    if (isComplexFlow) {
      complexFlowFunctions++;
      const severity: AuthSeverity = fnOps.some((o) => o.inLoop) ? 'high' : fnOps.length >= 4 ? 'medium' : 'low';

      findings.push({
        ruleId: 'soroban-auth-flow',
        severity,
        line: fn.line,
        message: `Function '${fn.name}' contains a complex authentication flow (${fnOps.length} auth checks${
          repeatedAddresses.length > 0 ? `, repeated for [${repeatedAddresses.join(', ')}]` : ''
        }).`,
        recommendation:
          'Consolidate authentication checks at function entry points and avoid invoking require_auth inside loops or redundant branches.',
        details: {
          caller: fn.name,
          authCount: fnOps.length,
          repeatedAddresses,
          isComplexFlow,
        },
      });
    }
  }

  return {
    operations,
    findings,
    metrics: {
      totalAuthChecks: operations.length,
      complexFlowFunctions,
      repeatedChecksDetected,
    },
  };
}
