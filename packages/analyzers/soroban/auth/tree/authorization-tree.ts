/**
 * Issue #917 — Soroban Authorization Tree Analyzer
 *
 * Builds a structured representation of Soroban authorization requirements:
 * tracks authorization requirements, builds authorization relationships,
 * identifies nested checks, and exposes authorization tree data.
 */

import {
  maskNonCode,
  extractFunctions,
  createLineResolver,
  blockStackAt,
  isInBranch,
  isInLoop,
  receiverBefore,
} from '../../common/source-utils';

export type AuthorizationNodeKind =
  | 'entrypoint'
  | 'auth-call'
  | 'nested-check'
  | 'conditional-branch'
  | 'cross-contract';

export interface AuthorizationTreeNode {
  id: string;
  kind: AuthorizationNodeKind;
  functionName: string;
  signer: string;
  line: number;
  column?: number;
  confidence: 'high' | 'medium';
  children: AuthorizationTreeNode[];
}

export interface AuthorizationTreeRoot extends AuthorizationTreeNode {
  kind: 'entrypoint';
  depth: number;
  authCalls: number;
  hasAuth: boolean;
}

export interface AuthorizationTreeReport {
  roots: AuthorizationTreeRoot[];
  totalEntrypoints: number;
  totalAuthNodes: number;
  maxDepth: number;
  unprotectedEntrypoints: string[];
  summary: string;
}

const AUTH_RE =
  /(\b[A-Za-z_][A-Za-z0-9_:]*\s*\.)?(require_auth|require_auth_for_args|authorize_as_parent|check_auth|authorized)\s*\(/g;

function columnOf(source: string, offset: number): number {
  const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
  return offset - lineStart + 1;
}

function nodeDepth(node: AuthorizationTreeNode): number {
  if (node.children.length === 0) return 1;
  return 1 + Math.max(...node.children.map(nodeDepth));
}

function countAuthNodes(node: AuthorizationTreeNode): number {
  let count = node.kind === 'auth-call' || node.kind === 'nested-check' ? 1 : 0;
  for (const child of node.children) count += countAuthNodes(child);
  return count;
}

/**
 * Build a structured authorization tree for Soroban contract source (#917).
 *
 * The root of each tree is the entrypoint function. Children come from
 * syntactic containment inside the function body plus one level of call
 * edges, so a `require_auth` inside a helper lands in the caller's subtree.
 * Nested checks are first-class nodes instead of brace-depth inferences.
 */
export function buildAuthorizationTree(source: string): AuthorizationTreeReport {
  const masked = maskNonCode(source);
  const lineOf = createLineResolver(source);
  const functions = extractFunctions(masked, source);
  const known = new Set(functions.map((f) => f.name));

  const directChildren = new Map<string, AuthorizationTreeNode[]>();
  const callEdges = new Map<string, string[]>();

  for (const fn of functions) {
    const fnBodyMasked = masked.slice(fn.bodyStart, fn.bodyEnd);
    const re = new RegExp(AUTH_RE.source, 'g');
    const flat: AuthorizationTreeNode[] = [];

    let m: RegExpExecArray | null;
    let index = 0;
    while ((m = re.exec(fnBodyMasked)) !== null) {
      const matchOffset = fn.bodyStart + m.index;
      const stack = blockStackAt(masked, fn.bodyStart, matchOffset);
      const nested = isInBranch(stack) || isInLoop(stack);
      const method = m[2];
      const dotIndex = m[1] ? matchOffset + m[1].length - 1 : -1;
      const signer =
        dotIndex >= 0
          ? receiverBefore(source, dotIndex) || 'unknown'
          : 'unknown';
      const line = lineOf(matchOffset);

      flat.push({
        id: `${fn.name}:${line}:${columnOf(source, matchOffset)}:${index++}`,
        kind: nested ? 'nested-check' : 'auth-call',
        functionName: fn.name,
        signer,
        line,
        column: columnOf(source, matchOffset),
        confidence: method === 'require_auth' || method === 'require_auth_for_args' ? 'high' : 'medium',
        children: [],
      });
    }

    const grouped = groupBranches(flat, fn.name);
    directChildren.set(fn.name, grouped);

    const callees = new Set<string>();
    const callRe = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
    let cm: RegExpExecArray | null;
    while ((cm = callRe.exec(fnBodyMasked)) !== null) {
      const callee = cm[1];
      if (known.has(callee) && callee !== fn.name) callees.add(callee);
    }
    callEdges.set(fn.name, [...callees]);
  }

  const roots: AuthorizationTreeRoot[] = [];
  for (const fn of functions) {
    const children: AuthorizationTreeNode[] = [...(directChildren.get(fn.name) ?? [])];
    const visited = new Set<string>([fn.name]);

    for (const callee of callEdges.get(fn.name) ?? []) {
      if (visited.has(callee)) continue;
      const calleeNodes = directChildren.get(callee) ?? [];
      if (calleeNodes.length === 0) continue;
      visited.add(callee);

      const callSite = findFirstCallSite(masked, fn, callee);
      children.push({
        id: `${fn.name}->${callee}:${callSite?.line ?? fn.line}`,
        kind: 'cross-contract',
        functionName: callee,
        signer: callee,
        line: callSite?.line ?? fn.line,
        confidence: 'medium',
        children: calleeNodes.map((n) => ({ ...n, children: [...n.children] })),
      });
    }

    const root: AuthorizationTreeRoot = {
      id: `${fn.name}:entry:${fn.line}`,
      kind: 'entrypoint',
      functionName: fn.name,
      signer: fn.name,
      line: fn.line,
      confidence: 'high',
      children,
      depth: 1,
      authCalls: 0,
      hasAuth: false,
    };
    root.authCalls = countAuthNodes(root);
    root.hasAuth = root.authCalls > 0;
    root.depth = nodeDepth(root);
    roots.push(root);
  }

  const totalAuthNodes = roots.reduce((acc, r) => acc + r.authCalls, 0);
  const maxDepth = roots.reduce((max, r) => Math.max(max, r.depth), 0);
  const unprotectedEntrypoints = roots.filter((r) => !r.hasAuth).map((r) => r.functionName);
  const summary =
    roots.length === 0
      ? 'No entrypoints found.'
      : unprotectedEntrypoints.length === 0
        ? `Authorization tree built for ${roots.length} entrypoint(s) with ${totalAuthNodes} auth node(s). All entrypoints enforce authorization.`
        : `Authorization tree built for ${roots.length} entrypoint(s) with ${totalAuthNodes} auth node(s). ` +
          `Unprotected: ${unprotectedEntrypoints.join(', ')}.`;

  return {
    roots,
    totalEntrypoints: roots.length,
    totalAuthNodes,
    maxDepth,
    unprotectedEntrypoints,
    summary,
  };
}

function groupBranches(flat: AuthorizationTreeNode[], fnName: string): AuthorizationTreeNode[] {
  if (flat.length <= 1) return flat;

  const nested = flat.filter((n) => n.kind === 'nested-check');
  const direct = flat.filter((n) => n.kind !== 'nested-check');
  if (nested.length <= 1) return flat;

  const branch: AuthorizationTreeNode = {
    id: `${fnName}:branch:${nested[0].line}`,
    kind: 'conditional-branch',
    functionName: fnName,
    signer: 'branch',
    line: nested[0].line,
    confidence: 'medium',
    children: nested,
  };
  return [...direct, branch];
}

function findFirstCallSite(
  masked: string,
  fn: { bodyStart: number; bodyEnd: number; line: number },
  callee: string,
): { line: number } | null {
  const body = masked.slice(fn.bodyStart, fn.bodyEnd);
  const re = new RegExp(`\\b${callee}\\s*\\(`);
  const m = re.exec(body);
  if (!m) return null;
  const absOffset = fn.bodyStart + m.index;
  let line = 1;
  for (let i = 0; i < absOffset && i < masked.length; i++) {
    if (masked[i] === '\n') line++;
  }
  return { line };
}

export class AuthorizationTreeAnalyzer {
  public static readonly RULE_ID = 'soroban-authorization-tree';

  public analyze(sourceCode: string): AuthorizationTreeReport {
    return buildAuthorizationTree(sourceCode);
  }
}
