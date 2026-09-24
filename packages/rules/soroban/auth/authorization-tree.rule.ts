/**
 * Rule: soroban-authorization-tree (#917)
 * Consumes the authorization tree to flag missing and nested auth gaps.
 */

import {
  buildAuthorizationTree,
  AuthorizationTreeAnalyzer,
  AuthorizationTreeReport,
} from '../../../analyzers/soroban/auth/tree/authorization-tree';

export interface AuthorizationTreeRuleFinding {
  ruleId: 'soroban-authorization-tree';
  severity: 'medium' | 'low';
  line: number;
  functionName: string;
  message: string;
  suggestion: string;
  details: {
    kind: 'missing_auth' | 'helper_only_auth';
    signer?: string;
  };
}

export interface AuthorizationTreeRuleReport {
  findings: AuthorizationTreeRuleFinding[];
  summary: string;
  metrics: {
    totalEntrypoints: number;
    unprotectedEntrypoints: number;
    totalAuthNodes: number;
  };
}

/**
 * Detect authorization tree issues in Soroban contract source code.
 */
export function detectAuthorizationTreeIssues(source: string): AuthorizationTreeRuleReport {
  const tree: AuthorizationTreeReport = buildAuthorizationTree(source);
  const findings: AuthorizationTreeRuleFinding[] = [];

  for (const root of tree.roots) {
    if (!root.hasAuth) {
      findings.push({
        ruleId: 'soroban-authorization-tree',
        severity: 'medium',
        line: root.line,
        functionName: root.functionName,
        message: `Entrypoint '${root.functionName}' has no authorization node in its authorization tree.`,
        suggestion: `Add an explicit require_auth call at the entry of '${root.functionName}' so the authorization tree covers every path.`,
        details: { kind: 'missing_auth' },
      });
      continue;
    }

    const directAuth = root.children.some(
      (c) => c.kind === 'auth-call' || c.kind === 'nested-check' || c.kind === 'conditional-branch',
    );
    const helperOnly = !directAuth && root.children.some((c) => c.kind === 'cross-contract');
    if (helperOnly) {
      findings.push({
        ruleId: 'soroban-authorization-tree',
        severity: 'low',
        line: root.line,
        functionName: root.functionName,
        message: `Entrypoint '${root.functionName}' relies only on helper-contract authorization without a direct check.`,
        suggestion: `Add a direct require_auth in '${root.functionName}' or document the helper authorization edge so auditors can follow the tree.`,
        details: { kind: 'helper_only_auth' },
      });
    }
  }

  const summary =
    findings.length === 0
      ? `Authorization tree covers ${tree.totalEntrypoints} entrypoint(s); all enforce authorization.`
      : `Authorization tree found ${findings.length} gap(s) across ${tree.totalEntrypoints} entrypoint(s).`;

  return {
    findings,
    summary,
    metrics: {
      totalEntrypoints: tree.totalEntrypoints,
      unprotectedEntrypoints: tree.unprotectedEntrypoints.length,
      totalAuthNodes: tree.totalAuthNodes,
    },
  };
}

export class AuthorizationTreeRule {
  public static readonly RULE_ID = 'soroban-authorization-tree';

  public evaluate(sourceCode: string): AuthorizationTreeRuleReport {
    return detectAuthorizationTreeIssues(sourceCode);
  }
}

export { AuthorizationTreeAnalyzer };
