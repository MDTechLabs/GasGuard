/**
 * Issue #920 — Soroban SAC Interaction Analyzer
 *
 * Scans Soroban (Rust) contract source for interactions with Stellar Asset
 * Contract (SAC) interfaces:
 *
 * 1. Detect SAC interactions — calls into a token/asset client
 *    (`token::Client::new(&env, &id).transfer(..)` and friends, including
 *    inline `sac::Client::new(..)` forms).
 * 2. Identify asset operations — calls that move or restrict the asset
 *    itself (transfer, transfer_from, mint, burn, burn_from, clawback,
 *    approve, revoke/bump allowance, set_authorized, set_admin).
 * 3. Track repeated calls — calls to the same asset with the same method and
 *    identical (normalized) arguments on the same execution path.
 *
 * The analysis is lexical: comments and string literals are masked out,
 * client bindings are resolved so later `<name>.transfer(..)` calls are
 * attributed to the token they were built from, and argument fingerprints
 * are normalized so `&to.clone()` and `&to` compare equal.
 */

import {
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

import {
  ASSET_OPERATION_METHODS,
  SAC_CLIENT_METHODS,
  SacAssetOperationFinding,
  SacCallSite,
  SacInteractionFinding,
  SacInteractionReport,
  SacOperationCategory,
  SacRepeatedCallFinding,
  Severity,
} from './types';

/** Map a SAC method to its asset-operation category (undefined = query). */
export function sacOperationCategory(method: string): SacOperationCategory | undefined {
  switch (method) {
    case 'transfer':
    case 'transfer_from':
    case 'clawback':
      return 'transfer';
    case 'mint':
    case 'burn':
    case 'burn_from':
      return 'supply';
    case 'approve':
    case 'revoke_allowance':
    case 'bump_allowance':
    case 'set_authorized':
      return 'authorization';
    case 'set_admin':
      return 'administration';
    default:
      return undefined;
  }
}

/**
 * Extract every SAC client call site from the source.
 *
 * Both call forms are covered:
 * - bound client:  `let client = token::Client::new(&env, &id);` then `client.transfer(..)`
 * - inline client: `token::Client::new(&env, &id).transfer(..)`
 */
export function extractSacCallSites(source: string): SacCallSite[] {
  const masked = maskNonCode(source);
  const lineOf = createLineResolver(source);
  const bindings = resolveTokenBindings(masked, source);
  const functions = extractFunctions(masked, source);
  const sites: SacCallSite[] = [];

  // `try_` variants return a Result — flag them separately.
  const methodRe = new RegExp(
    `\\.\\s*(try_)?(${[...SAC_CLIENT_METHODS].join('|')})\\s*\\(`,
    'g',
  );

  let m: RegExpExecArray | null;
  while ((m = methodRe.exec(masked)) !== null) {
    const enclosing = functions.find(
      (f) => m.index >= f.bodyStart && m.index < f.bodyEnd,
    );
    if (!enclosing) continue;

    const receiver = receiverBefore(source, m.index);
    const asset = resolveTokenFromReceiver(receiver, bindings);

    // Non-SAC receivers (env, storage handles, plain field names) are not
    // asset-contract interactions.
    if (receiver === '' || /^(env|self|storage)/.test(asset)) continue;

    const openParen = m.index + m[0].length - 1;
    const args = splitArgs(extractArgs(masked, source, openParen).text);
    const stack = blockStackAt(masked, enclosing.bodyStart, m.index);
    const method = (m[1] ? 'try_' : '') + m[2];

    sites.push({
      fn: enclosing.name,
      asset,
      method,
      argsFingerprint: fingerprintArgs(args),
      line: lineOf(m.index),
      offset: m.index,
      stack,
      inLoop: isInLoop(stack),
      isTryCall: Boolean(m[1]),
      fullCall: `${receiver.trim()}.${method}(${args.map(normalizeExpr).join(', ')})`,
    });
  }

  return sites.sort((a, b) => a.offset - b.offset);
}

/** Fingerprint a call's arguments so repeated/redundant detection is robust. */
function fingerprintArgs(args: string[]): string {
  return args.map(normalizeExpr).join('|');
}

/**
 * Group identical SAC calls: same (function, asset, method, argument
 * fingerprint) occurring more than once on the same execution path.
 */
export function findRepeatedSacCalls(source: string, sites: SacCallSite[]): SacCallSite[] {
  const groups = new Map<string, SacCallSite[]>();

  for (const site of sites) {
    const key = `${site.fn}|${site.asset}|${site.method}|${site.argsFingerprint}`;
    const list = groups.get(key) ?? [];
    list.push(site);
    groups.set(key, list);
  }

  const repeated: SacCallSite[] = [];

  for (const list of groups.values()) {
    for (let i = 1; i < list.length; i++) {
      // Calls on exclusive branches cannot both execute in one run; only
      // flag a repeat when both sites share an execution path.
      if (onExclusiveBranches(list[i - 1].stack, list[i].stack)) continue;
      repeated.push(list[i]);
    }
  }

  return repeated.sort((a, b) => a.offset - b.offset);
}

/**
 * Full SAC interaction analysis: sites, asset operations, repeated calls.
 */
export function analyzeSacInteractions(source: string): SacInteractionReport {
  const sites = extractSacCallSites(source);

  const assetOperations = sites.filter((s) =>
    ASSET_OPERATION_METHODS.has(s.method.replace(/^try_/, '')),
  );
  const repeatedCalls = findRepeatedSacCalls(source, sites);

  const metrics = {
    totalSacCalls: sites.length,
    assetOperations: assetOperations.length,
    uniqueAssets: new Set(sites.map((s) => s.asset)).size,
    repeatedCalls: repeatedCalls.length,
    callsInLoop: sites.filter((s) => s.inLoop).length,
  };

  return { callSites: sites, assetOperations, repeatedCalls, metrics };
}

/** Human-facing SAC interaction findings (#920). */
export function sacInteractionFindings(source: string): {
  interactions: SacInteractionFinding[];
  assetOperations: SacAssetOperationFinding[];
  repeatedCalls: SacRepeatedCallFinding[];
} {
  const report = analyzeSacInteractions(source);

  const interactions: SacInteractionFinding[] = report.callSites.map((s) => ({
    kind: 'interaction' as const,
    severity: (s.inLoop ? 'high' : 'info') as Severity,
    line: s.line,
    fn: s.fn,
    asset: s.asset,
    method: s.method,
    message: `SAC interaction: '${s.method}' on asset '${s.asset}' in function '${s.fn}' at line ${s.line}${s.inLoop ? ' (inside a loop)' : ''}.`,
    suggestion: s.inLoop
      ? 'Hoist the SAC interaction outside the loop or cache its result; repeated asset calls burn CPU and read budget.'
      : 'Batch or cache SAC interactions where the asset state cannot change between calls.',
  }));

  const assetOperationFindings: SacAssetOperationFinding[] = report.assetOperations.map(
    (s) => ({
      kind: 'asset_operation' as const,
      severity: (s.inLoop ? 'high' : 'medium') as Severity,
      line: s.line,
      fn: s.fn,
      asset: s.asset,
      method: s.method,
      operation: sacOperationCategory(s.method.replace(/^try_/, '')) ?? 'transfer',
      message: `Asset operation '${s.method}' on asset '${s.asset}' in function '${s.fn}' at line ${s.line}.`,
      suggestion:
        'Group asset operations and reuse client instances to keep resource usage bounded.',
    }),
  );

  // Attach first-occurrence line + occurrence count for the repeated calls.
  const repeatedCallFindings: SacRepeatedCallFinding[] = report.repeatedCalls.map((s) => {
    const group = report.callSites.filter(
      (c) =>
        c.fn === s.fn &&
        c.asset === s.asset &&
        c.method === s.method &&
        c.argsFingerprint === s.argsFingerprint &&
        c.offset < s.offset,
    );
    const first = group[0];
    return {
      kind: 'repeated_call' as const,
      severity: (s.inLoop ? 'high' : 'medium') as Severity,
      line: s.line,
      firstLine: first ? first.line : s.line,
      fn: s.fn,
      asset: s.asset,
      method: s.method,
      callCount: group.length + 1,
      message: `Repeated SAC call '${s.method}' on asset '${s.asset}' with identical inputs at line ${s.line} (first at line ${first ? first.line : s.line}).`,
      suggestion:
        'Reuse the first call result or batch the operations instead of repeating the SAC call.',
    };
  });

  return {
    interactions,
    assetOperations: assetOperationFindings,
    repeatedCalls: repeatedCallFindings,
  };
}
