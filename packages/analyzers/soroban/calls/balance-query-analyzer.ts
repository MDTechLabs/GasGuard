/**
 * Soroban Balance Query Analyzer
 *
 * Detects repeated token balance reads along a single transaction path. Each
 * `balance()` read is a contract call (or a storage read) that costs CPU and
 * ledger-read budget, so re-reading an unchanged balance is pure overhead.
 *
 * A repeat is only reported as safely reusable when nothing between the two
 * reads can have changed the balance: no transfer/mint/burn on that token, no
 * storage write, and no opaque cross-contract call. Otherwise the repeat is
 * reported at `info` severity with the mutation that forces the re-read, so the
 * suggestion never trades correctness for budget.
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

/** Method-style balance reads: `client.balance(&addr)`. */
const BALANCE_METHODS = ['balance', 'balance_of', 'spendable_balance'];

/** Free-function balance reads: `read_balance(&env, &addr)`. */
const BALANCE_FUNCTIONS = ['read_balance', 'get_balance', 'load_balance'];

/**
 * Operations that can change a balance. Anything matching between two reads
 * invalidates reuse of the first result.
 */
const MUTATION_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'token transfer', pattern: /\.\s*transfer(_from)?\s*\(/ },
  { label: 'token mint', pattern: /\.\s*mint\s*\(/ },
  { label: 'token burn', pattern: /\.\s*burn(_from)?\s*\(/ },
  { label: 'token clawback', pattern: /\.\s*clawback\s*\(/ },
  { label: 'balance write', pattern: /\b(write_balance|set_balance|receive_balance|spend_balance)\s*\(/ },
  { label: 'storage write', pattern: /\.\s*storage\s*\(\s*\)[\s\S]{0,80}?\.\s*(set|update|remove|extend_ttl)\s*\(/ },
  { label: 'cross-contract call', pattern: /\b(invoke_contract|try_invoke_contract)\s*[:(<]/ },
];

export interface BalanceQuery {
  /** Enclosing function name. */
  fn: string;
  /** Token/asset the balance is read from. */
  asset: string;
  /** Account whose balance is read. */
  account: string;
  /** The method or function used for the read. */
  method: string;
  line: number;
  /** Character offset of the call site. */
  offset: number;
  stack: BlockFrame[];
  inLoop: boolean;
}

/** A set of balance reads sharing the same (function, asset, account) inputs. */
export interface BalanceQueryGroup {
  fn: string;
  asset: string;
  account: string;
  count: number;
  lines: number[];
  /** True when every repeat in the group can reuse the first result. */
  safeToReuse: boolean;
  /** The mutation (if any) that forces a re-read. */
  invalidatedBy?: string;
  /** Line of the mutation that forces a re-read. */
  invalidatedAtLine?: number;
}

export interface BalanceQueryFinding {
  ruleId: 'soroban-redundant-balance-query' | 'soroban-balance-query-in-loop';
  severity: Severity;
  line: number;
  relatedLines: number[];
  fn: string;
  asset: string;
  account: string;
  message: string;
  suggestion: string;
  /** True when the repeated read may be replaced by a cached value. */
  safeToReuse: boolean;
}

export interface BalanceQueryReport {
  queries: BalanceQuery[];
  groups: BalanceQueryGroup[];
  findings: BalanceQueryFinding[];
  metrics: {
    totalQueries: number;
    uniqueInputs: number;
    redundantQueries: number;
    reusableQueries: number;
  };
}

/**
 * Extract every balance read from Soroban Rust source, resolving the asset each
 * read targets and the account it is keyed on.
 */
export function extractBalanceQueries(source: string): BalanceQuery[] {
  const masked = maskNonCode(source);
  const lineOf = createLineResolver(source);
  const bindings = resolveTokenBindings(masked, source);
  const functions = extractFunctions(masked, source);
  const queries: BalanceQuery[] = [];

  const methodRe = new RegExp(`\\.\\s*(${BALANCE_METHODS.join('|')})\\s*\\(`, 'g');
  const fnRe = new RegExp(`(?<![.\\w])(${BALANCE_FUNCTIONS.join('|')})\\s*\\(`, 'g');

  const record = (
    index: number,
    method: string,
    openParen: number,
    asset: string,
  ): void => {
    const enclosing = functions.find((f) => index >= f.bodyStart && index < f.bodyEnd);
    if (!enclosing) return;

    const args = splitArgs(extractArgs(masked, source, openParen).text);
    // The account is the last argument; `&env` leads the free-function form.
    const account = args.length > 0 ? normalizeExpr(args[args.length - 1]) : 'unknown';
    const stack = blockStackAt(masked, enclosing.bodyStart, index);

    queries.push({
      fn: enclosing.name,
      asset,
      account,
      method,
      line: lineOf(index),
      offset: index,
      stack,
      inLoop: isInLoop(stack),
    });
  };

  let m: RegExpExecArray | null;
  while ((m = methodRe.exec(masked)) !== null) {
    const receiver = receiverBefore(source, m.index);
    record(m.index, m[1], m.index + m[0].length - 1, resolveTokenFromReceiver(receiver, bindings));
  }

  while ((m = fnRe.exec(masked)) !== null) {
    // Skip the declaration of the helper itself.
    if (/\bfn\s+$/.test(masked.slice(Math.max(0, m.index - 8), m.index))) continue;
    record(m.index, m[1], m.index + m[0].length - 1, 'self');
  }

  return queries.sort((a, b) => a.offset - b.offset);
}

/**
 * Find the first balance-mutating operation between two offsets, if any.
 */
function findMutationBetween(
  source: string,
  masked: string,
  start: number,
  end: number,
): { label: string; line: number } | undefined {
  const segment = masked.slice(start, end);
  const lineOf = createLineResolver(source);

  let best: { label: string; line: number; offset: number } | undefined;
  for (const { label, pattern } of MUTATION_PATTERNS) {
    const match = segment.match(pattern);
    if (match?.index === undefined) continue;
    const offset = start + match.index;
    if (!best || offset < best.offset) {
      best = { label, line: lineOf(offset), offset };
    }
  }

  return best ? { label: best.label, line: best.line } : undefined;
}

/**
 * Group balance reads by their (function, asset, account) inputs and decide,
 * per group, whether the repeats may reuse the first result.
 */
export function groupBalanceQueries(
  source: string,
  queries: BalanceQuery[],
): BalanceQueryGroup[] {
  const masked = maskNonCode(source);
  const buckets = new Map<string, BalanceQuery[]>();

  for (const q of queries) {
    const key = `${q.fn}|${q.asset}|${q.account}`;
    const list = buckets.get(key) ?? [];
    list.push(q);
    buckets.set(key, list);
  }

  const groups: BalanceQueryGroup[] = [];

  for (const list of buckets.values()) {
    const [first] = list;
    let safeToReuse = list.length > 1;
    let invalidatedBy: string | undefined;
    let invalidatedAtLine: number | undefined;

    for (let i = 1; i < list.length && safeToReuse; i++) {
      const prev = list[i - 1];
      const current = list[i];

      const mutation = findMutationBetween(source, masked, prev.offset, current.offset);
      if (mutation) {
        safeToReuse = false;
        invalidatedBy = mutation.label;
        invalidatedAtLine = mutation.line;
        break;
      }

      if (onExclusiveBranches(prev.stack, current.stack)) {
        safeToReuse = false;
        invalidatedBy = 'conditional branch — the reads are on different paths';
        invalidatedAtLine = current.line;
      }
    }

    groups.push({
      fn: first.fn,
      asset: first.asset,
      account: first.account,
      count: list.length,
      lines: list.map((q) => q.line),
      safeToReuse,
      invalidatedBy,
      invalidatedAtLine,
    });
  }

  return groups.sort((a, b) => b.count - a.count);
}

/**
 * Turn grouped queries into optimization findings.
 */
export function generateBalanceFindings(
  queries: BalanceQuery[],
  groups: BalanceQueryGroup[],
): BalanceQueryFinding[] {
  const findings: BalanceQueryFinding[] = [];

  for (const group of groups) {
    if (group.count < 2) continue;

    const [line, ...relatedLines] = group.lines;
    const severity: Severity = !group.safeToReuse
      ? 'info'
      : group.count >= 4
        ? 'high'
        : group.count >= 3
          ? 'medium'
          : 'low';

    findings.push({
      ruleId: 'soroban-redundant-balance-query',
      severity,
      line,
      relatedLines,
      fn: group.fn,
      asset: group.asset,
      account: group.account,
      message:
        `Balance of '${group.account}' on asset '${group.asset}' is queried ${group.count} times ` +
        `in '${group.fn}' (lines: ${group.lines.join(', ')}).`,
      suggestion: group.safeToReuse
        ? `Read the balance once into a local variable and reuse it — nothing between lines ${group.lines[0]} and ${group.lines[group.lines.length - 1]} can change it, saving ${group.count - 1} read(s).`
        : `Keep the re-read: a ${group.invalidatedBy} at line ${group.invalidatedAtLine} may change this balance. Reuse only the reads that precede it.`,
      safeToReuse: group.safeToReuse,
    });
  }

  // A balance read inside a loop with loop-invariant inputs repeats per iteration.
  const loopSeen = new Set<string>();
  for (const q of queries) {
    if (!q.inLoop) continue;
    const key = `${q.fn}|${q.asset}|${q.account}`;
    if (loopSeen.has(key)) continue;
    loopSeen.add(key);

    findings.push({
      ruleId: 'soroban-balance-query-in-loop',
      severity: 'high',
      line: q.line,
      relatedLines: [],
      fn: q.fn,
      asset: q.asset,
      account: q.account,
      message: `Balance of '${q.account}' on asset '${q.asset}' is queried inside a loop in '${q.fn}'.`,
      suggestion:
        'Hoist the balance read above the loop if the account and asset do not vary per iteration; ' +
        'otherwise track the running balance locally instead of re-reading it.',
      safeToReuse: true,
    });
  }

  return findings.sort((a, b) => a.line - b.line);
}

/**
 * Full analysis entry point.
 */
export function analyzeBalanceQueries(source: string): BalanceQueryReport {
  const queries = extractBalanceQueries(source);
  const groups = groupBalanceQueries(source, queries);
  const findings = generateBalanceFindings(queries, groups);

  const redundantQueries = groups.reduce(
    (sum, g) => sum + (g.count > 1 ? g.count - 1 : 0),
    0,
  );
  const reusableQueries = groups.reduce(
    (sum, g) => sum + (g.safeToReuse && g.count > 1 ? g.count - 1 : 0),
    0,
  );

  return {
    queries,
    groups,
    findings,
    metrics: {
      totalQueries: queries.length,
      uniqueInputs: groups.length,
      redundantQueries,
      reusableQueries,
    },
  };
}
