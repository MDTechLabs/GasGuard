/**
 * Soroban Token Transfer Analyzer
 *
 * Detects token transfers that can be avoided or consolidated:
 *  - repeated transfers along the same (token, from → to) edge
 *  - relay chains where funds hop through an intermediate holder (A → B → C)
 *  - self-transfers and zero-amount transfers, which are pure overhead
 *
 * Every suggestion is gated on a safety check: transfers on mutually exclusive
 * branches, transfers separated by an authorization or state check, and
 * transfers inside loops are reported as `preserved` and never proposed for
 * consolidation, because collapsing them would change the contract's
 * security-relevant behaviour.
 */

import {
  BlockFrame,
  blockStackAt,
  createLineResolver,
  extractArgs,
  extractFunctions,
  isInLoop,
  maskNonCode,
  normalizeExpr,
  onExclusiveBranches,
  receiverBefore,
  resolveTokenBindings,
  resolveTokenFromReceiver,
  splitArgs,
} from '../common/source-utils';

export type Severity = 'high' | 'medium' | 'low' | 'info';

/** Transfer-shaped token methods and the argument slots they use. */
const TRANSFER_METHODS: Record<string, { from: number; to: number; amount: number }> = {
  transfer: { from: 0, to: 1, amount: 2 },
  transfer_from: { from: 1, to: 2, amount: 3 },
  // `mint`/`burn` move value but have no `from`/`to` pair; handled separately.
};

/** Calls that mint or destroy supply — value-moving, but not consolidatable. */
const SUPPLY_METHODS = new Set(['mint', 'burn', 'burn_from', 'clawback']);

/** Calls whose presence between two transfers makes consolidation unsafe. */
const SECURITY_CHECK_PATTERN =
  /\b(require_auth|require_auth_for_args|authorize_as_current_contract|check_auth|panic_with_error|assert!|assert_eq!|require!|unwrap_or_else)\s*[(!]/;

export interface TransferSite {
  /** Enclosing function name. */
  fn: string;
  /** Token contract the transfer targets (resolved from the client binding). */
  token: string;
  /** Method name: `transfer` or `transfer_from`. */
  method: string;
  /** Normalized source account expression. */
  from: string;
  /** Normalized destination account expression. */
  to: string;
  /** Normalized amount expression. */
  amount: string;
  line: number;
  /** Character offset of the call site. */
  offset: number;
  /** Enclosing block frames, used for branch/loop safety checks. */
  stack: BlockFrame[];
  /** True when the transfer executes inside a loop body. */
  inLoop: boolean;
}

/** A directed edge in the transfer graph of a single function. */
export interface TransferEdge {
  fn: string;
  token: string;
  from: string;
  to: string;
  /** Number of transfers along this edge. */
  count: number;
  lines: number[];
  amounts: string[];
}

export interface TransferPath {
  fn: string;
  token: string;
  /** Ordered account hops, e.g. `['user', 'contract', 'treasury']`. */
  hops: string[];
  lines: number[];
}

export interface TokenTransferFinding {
  ruleId:
    | 'soroban-redundant-token-transfer'
    | 'soroban-intermediate-token-transfer'
    | 'soroban-self-token-transfer'
    | 'soroban-zero-token-transfer';
  severity: Severity;
  line: number;
  /** Other lines participating in the same finding. */
  relatedLines: number[];
  fn: string;
  token: string;
  message: string;
  suggestion: string;
  /**
   * True when the transfers were left intact on purpose: an auth check, an
   * exclusive branch or a loop makes consolidation security-sensitive.
   */
  preserved: boolean;
  /** Why the finding was preserved rather than proposed for consolidation. */
  preservedReason?: string;
}

export interface TokenTransferReport {
  transfers: TransferSite[];
  edges: TransferEdge[];
  paths: TransferPath[];
  findings: TokenTransferFinding[];
  metrics: {
    totalTransfers: number;
    uniqueEdges: number;
    redundantTransfers: number;
    consolidationOpportunities: number;
    preservedTransfers: number;
  };
}

/**
 * Extract every token transfer call site from Soroban Rust source.
 */
export function extractTransfers(source: string): TransferSite[] {
  const masked = maskNonCode(source);
  const lineOf = createLineResolver(source);
  const bindings = resolveTokenBindings(masked, source);
  const functions = extractFunctions(masked, source);
  const sites: TransferSite[] = [];

  const methodNames = Object.keys(TRANSFER_METHODS).join('|');
  const callRe = new RegExp(`\\.\\s*(${methodNames})\\s*\\(`, 'g');

  let m: RegExpExecArray | null;
  while ((m = callRe.exec(masked)) !== null) {
    const method = m[1];
    const slots = TRANSFER_METHODS[method];
    const openParen = m.index + m[0].length - 1;
    const args = splitArgs(extractArgs(masked, source, openParen).text);

    // A real transfer supplies at least the destination and amount.
    if (args.length <= slots.amount) continue;

    const enclosing = functions.find(
      (f) => m!.index >= f.bodyStart && m!.index < f.bodyEnd,
    );
    if (!enclosing) continue;

    const receiver = receiverBefore(source, m.index);
    const stack = blockStackAt(masked, enclosing.bodyStart, m.index);

    sites.push({
      fn: enclosing.name,
      token: resolveTokenFromReceiver(receiver, bindings),
      method,
      from: normalizeExpr(args[slots.from]),
      to: normalizeExpr(args[slots.to]),
      amount: normalizeExpr(args[slots.amount]),
      line: lineOf(m.index),
      offset: m.index,
      stack,
      inLoop: isInLoop(stack),
    });
  }

  return sites.sort((a, b) => a.offset - b.offset);
}

/**
 * Collapse transfer sites into the directed edges of a per-function graph.
 */
export function buildTransferEdges(transfers: TransferSite[]): TransferEdge[] {
  const edges = new Map<string, TransferEdge>();

  for (const t of transfers) {
    const key = `${t.fn}|${t.token}|${t.from}->${t.to}`;
    let edge = edges.get(key);
    if (!edge) {
      edge = { fn: t.fn, token: t.token, from: t.from, to: t.to, count: 0, lines: [], amounts: [] };
      edges.set(key, edge);
    }
    edge.count += 1;
    edge.lines.push(t.line);
    edge.amounts.push(t.amount);
  }

  return Array.from(edges.values()).sort((a, b) => b.count - a.count);
}

/**
 * Trace multi-hop transfer paths — a destination that is itself the source of a
 * later transfer of the same token within the same function.
 */
export function traceTransferPaths(transfers: TransferSite[]): TransferPath[] {
  const paths: TransferPath[] = [];

  for (let i = 0; i < transfers.length; i++) {
    const first = transfers[i];

    for (let j = i + 1; j < transfers.length; j++) {
      const second = transfers[j];
      if (second.fn !== first.fn || second.token !== first.token) continue;
      if (second.from !== first.to) continue;
      if (first.to === first.from || second.to === second.from) continue;

      paths.push({
        fn: first.fn,
        token: first.token,
        hops: [first.from, first.to, second.to],
        lines: [first.line, second.line],
      });
    }
  }

  return paths;
}

/**
 * Decide whether two transfer sites may be consolidated, and if not, why.
 */
function consolidationBlocker(
  source: string,
  a: TransferSite,
  b: TransferSite,
): string | undefined {
  if (a.inLoop || b.inLoop) {
    return 'transfer executes inside a loop, so the number of transfers is data-dependent';
  }
  if (onExclusiveBranches(a.stack, b.stack)) {
    return 'transfers sit on different conditional paths and may not both execute';
  }

  const between = source.slice(a.offset, b.offset);
  if (SECURITY_CHECK_PATTERN.test(between)) {
    return 'an authorization or assertion between the transfers may depend on the first having settled';
  }

  return undefined;
}

/**
 * Detect transfers that are redundant, avoidable, or worth consolidating.
 */
export function detectTransferIssues(
  source: string,
  transfers: TransferSite[],
  paths: TransferPath[],
): TokenTransferFinding[] {
  const findings: TokenTransferFinding[] = [];

  // Self-transfers and zero-amount transfers: always removable.
  for (const t of transfers) {
    if (t.from === t.to && t.from.length > 0) {
      findings.push({
        ruleId: 'soroban-self-token-transfer',
        severity: 'medium',
        line: t.line,
        relatedLines: [],
        fn: t.fn,
        token: t.token,
        message: `Transfer of token '${t.token}' in '${t.fn}' sends from and to the same address '${t.from}'.`,
        suggestion: 'Remove the self-transfer — it changes no balance but still pays the full contract-call cost.',
        preserved: false,
      });
    }

    if (/^0(?:i128|u128|i64|u64)?$/.test(t.amount)) {
      findings.push({
        ruleId: 'soroban-zero-token-transfer',
        severity: 'low',
        line: t.line,
        relatedLines: [],
        fn: t.fn,
        token: t.token,
        message: `Transfer of token '${t.token}' in '${t.fn}' moves a hard-coded zero amount.`,
        suggestion: 'Drop the zero-amount transfer, or guard it behind an `if amount > 0` check.',
        preserved: false,
      });
    }
  }

  // Repeated transfers along an identical (token, from → to) edge.
  const groups = new Map<string, TransferSite[]>();
  for (const t of transfers) {
    if (t.from === t.to) continue; // already reported as a self-transfer
    const key = `${t.fn}|${t.token}|${t.from}->${t.to}`;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;

    const [first] = group;
    const blockers = group
      .slice(1)
      .map((t) => consolidationBlocker(source, first, t))
      .filter((r): r is string => r !== undefined);

    const lines = group.map((t) => t.line);
    const preserved = blockers.length > 0;

    findings.push({
      ruleId: 'soroban-redundant-token-transfer',
      severity: preserved ? 'info' : group.length >= 3 ? 'high' : 'medium',
      line: first.line,
      relatedLines: lines.slice(1),
      fn: first.fn,
      token: first.token,
      message:
        `Token '${first.token}' is transferred from '${first.from}' to '${first.to}' ` +
        `${group.length} times in '${first.fn}' (lines: ${lines.join(', ')}).`,
      suggestion: preserved
        ? `Left as-is: ${blockers[0]}. Verify the repetition is intentional before merging these transfers.`
        : `Sum the amounts (${group.map((t) => t.amount).join(' + ')}) and issue a single transfer to '${first.to}', saving ${group.length - 1} contract call(s).`,
      preserved,
      preservedReason: blockers[0],
    });
  }

  // Relay chains: A → B → C with the same token and amount.
  const seenPaths = new Set<string>();
  for (const path of paths) {
    const key = `${path.fn}|${path.token}|${path.hops.join('->')}`;
    if (seenPaths.has(key)) continue;
    seenPaths.add(key);

    const [firstLine, secondLine] = path.lines;
    const a = transfers.find((t) => t.line === firstLine && t.fn === path.fn);
    const b = transfers.find((t) => t.line === secondLine && t.fn === path.fn);
    if (!a || !b) continue;

    const blocker = consolidationBlocker(source, a, b);
    // Amounts must match for a direct transfer to be equivalent.
    const sameAmount = a.amount === b.amount;
    const preserved = blocker !== undefined || !sameAmount;

    findings.push({
      ruleId: 'soroban-intermediate-token-transfer',
      severity: preserved ? 'info' : 'medium',
      line: firstLine,
      relatedLines: [secondLine],
      fn: path.fn,
      token: path.token,
      message:
        `Token '${path.token}' hops through intermediate holder '${path.hops[1]}' ` +
        `(${path.hops.join(' → ')}) in '${path.fn}' at lines ${path.lines.join(', ')}.`,
      suggestion: preserved
        ? `Left as-is: ${blocker ?? 'the two hops move different amounts, so the intermediate balance is load-bearing'}.`
        : `Transfer directly from '${path.hops[0]}' to '${path.hops[2]}' if '${path.hops[1]}' does not need custody, removing one contract call.`,
      preserved,
      preservedReason: blocker ?? (sameAmount ? undefined : 'hops move different amounts'),
    });
  }

  return findings.sort((a, b) => a.line - b.line);
}

/**
 * Full analysis entry point.
 */
export function analyzeTokenTransfers(source: string): TokenTransferReport {
  const transfers = extractTransfers(source);
  const edges = buildTransferEdges(transfers);
  const paths = traceTransferPaths(transfers);
  const findings = detectTransferIssues(source, transfers, paths);

  const redundantTransfers = edges
    .filter((e) => e.count > 1)
    .reduce((sum, e) => sum + (e.count - 1), 0);

  return {
    transfers,
    edges,
    paths,
    findings,
    metrics: {
      totalTransfers: transfers.length,
      uniqueEdges: edges.length,
      redundantTransfers,
      consolidationOpportunities: findings.filter((f) => !f.preserved).length,
      preservedTransfers: findings.filter((f) => f.preserved).length,
    },
  };
}

/** Exposed for callers that want to flag supply-changing token calls. */
export function isSupplyMethod(method: string): boolean {
  return SUPPLY_METHODS.has(method);
}
