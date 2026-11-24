/**
 * GG-TOKEN-REBASE-001 — Stored token quantities that assume balances only change through the
 * contract's own transfers.
 *
 * Tracing: in each function the rule finds token amounts pulled into the contract
 * (`token.transferFrom(x, address(this), amount)`) and the state variables that record them
 * (`deposits[user] += amount`, `totalDeposited = token.balanceOf(address(this))`, balance deltas).
 * It then finds the functions that later pay out the same token using that stored quantity
 * (`token.transfer(to, amount)` where `amount` is tied to the variable). With a rebasing token
 * (stETH, aTokens, AMPL ...) the contract's real balance moves without any transfer, so the stored
 * claim is stale: a negative rebase leaves the contract insolvent (early withdrawers drain the
 * rest), a positive rebase strands the surplus.
 *
 * Recognized as safe, and not reported:
 *  - share-based designs: variables named like shares/scaled balances, amounts converted through
 *    shares (`convertToShares`, `getPooledEthByShares`, ...), and payouts computed from the live
 *    `balanceOf(address(this))` (pro-rata);
 *  - explicit rebasing exclusions: a `// gasguard-no-rebasing`, `@custom:no-rebasing` or "rebasing
 *    tokens are not supported" comment in the contract, an on-chain guard (`require(!isRebasing(t))`),
 *    or the `nonRebasingTokens` option (token identifiers).
 *
 * Supported: Solidity 0.6 - 0.8.x, single source string; token identity is read from receiver names
 * and no token code is visible, so a verdict is a prompt for review. No project scripts or
 * configuration are executed. See docs/rules/token-rebasing-balance-assumptions.md.
 */
import {
  Diagnostic,
  RuleResult,
  SecurityFinding,
  SolFunction,
  makeFinding,
  prepareSource,
  statementsOf,
} from '../lib/solidity-lite';
import { buildSourceModel } from '../lib/solidity-inheritance';
import { expandWords, findTokenCalls, isSelf, localDefs, words } from './token-calls';

export const RULE_ID = 'GG-TOKEN-REBASE-001';

export interface RebasingOptions {
  /** Token identifiers (variable names) known not to rebase. */
  nonRebasingTokens?: string[];
}

export interface TrackedBalance {
  contract: string;
  variable: string;
  token: string;
  storedIn: { function: string; line: number }[];
  settledIn: { function: string; line: number }[];
  status: 'stale-risk' | 'share-based' | 'excluded' | 'unsettled';
  reason?: string;
}

export interface RebasingResult extends RuleResult {
  tracked: TrackedBalance[];
}

const SHARE_NAME = /(share|scaled|units?$|^_?index)/i;
const SHARE_CONVERT = /\b(?:convertToShares|convertToAssets|getSharesByPooledEth|getPooledEthByShares|sharesToAmount|amountToShares|toShares|toAssets|previewDeposit|previewRedeem|previewWithdraw|sharesOf|unwrap|wrap)\b/;
const LIVE_BALANCE = /\bbalanceOf\s*\(\s*address\s*\(\s*this\s*\)\s*\)/;
const KNOWN_REBASING = /(steth|stEth|aToken|^a[A-Z]\w*|ampl|ohm|rebas|elastic|lido|yvToken)/;
const STABLE_NAME = /^(?:usdc|usdt|dai|weth|wbtc|wsteth)$/i;
const EXCLUSION_TEXT = /@custom:no-rebasing|gasguard-no-rebasing|rebas\w*[^\n.]{0,80}(?:not supported|unsupported|not allowed|disallowed|excluded|banned|incompatible|not compatible)|(?:no|non|not|without)[- ]rebas\w*|does not support[^\n.]{0,40}rebas/i;
const GUARD_RE = /\b(?:require|if)\s*\(\s*!?\s*(?:_?isRebasing|_?rebasingTokens?|_?nonRebasing\w*|_?isNonRebasing)\b|\b_?revertIfRebasing\s*\(/;
const ASSIGN = /^\s*([A-Za-z_$][\w$]*)((?:\s*\[[^\]]*\])*)\s*([-+])?=(?!=)\s*([\s\S]*)$/;

interface Store {
  root: string;
  line: number;
  fn: SolFunction;
  token: string;
  share: boolean;
}

export function detectRebasingBalanceAssumptions(input: unknown, options: RebasingOptions = {}): RebasingResult {
  const prep = prepareSource(input);
  if (!prep.ok) return { ruleId: RULE_ID, analyzed: false, findings: [], diagnostics: prep.diagnostics, tracked: [] };
  const { source, masked } = prep.prepared;
  const diagnostics: Diagnostic[] = [...prep.diagnostics];
  let nonRebasing = new Set<string>();
  if (options.nonRebasingTokens !== undefined) {
    if (Array.isArray(options.nonRebasingTokens) && options.nonRebasingTokens.every((n) => typeof n === 'string' && /^[\w$.\[\]]+$/.test(n))) {
      nonRebasing = new Set(options.nonRebasingTokens);
    } else {
      diagnostics.push({ level: 'warning', code: 'invalid-option', message: 'Ignored invalid nonRebasingTokens list.' });
    }
  }

  const src = buildSourceModel(masked, source, diagnostics);
  const findings: SecurityFinding[] = [];
  const tracked: TrackedBalance[] = [];

  for (const model of src.contracts.values()) {
    if (!model.isLeaf || model.contract.kind !== 'contract') continue;
    const stateNames = new Set(model.stateVars.map((v) => v.name));
    const isState = (n: string) => stateNames.has(n);
    const contractText = model.linearization.map((c) => source.slice(c.open, c.close)).join('\n');
    const documentedExclusion = EXCLUSION_TEXT.test(contractText);

    const prepared = model.functions.map((fn) => {
      const statements = statementsOf(fn, source);
      const texts = statements.map((s) => s.text);
      return { fn, statements, defs: localDefs(texts, isState) };
    });

    // 1. Stored quantities: state variables written from a pulled amount or a live balance.
    const stores = new Map<string, Store[]>();
    const guardedFns = new Set<SolFunction>();
    for (const { fn, statements, defs } of prepared) {
      if (fn.mutability === 'view' || fn.mutability === 'pure') continue;
      if (GUARD_RE.test(fn.body)) guardedFns.add(fn);
      const pulls = statements.flatMap((s) => findTokenCalls(s.text).filter((c) => /transferFrom$/i.test(c.method) && c.args[1] !== undefined && isSelf(c.args[1])));
      const liveReads = new Map<string, string>(); // local name -> token
      for (const [name, rhs] of defs) for (const c of findTokenCalls(rhs)) if (c.method === 'balanceOf' && c.args.length === 1 && isSelf(c.args[0])) liveReads.set(name, c.token);
      for (const s of statements) {
        const m = ASSIGN.exec(s.text);
        if (!m || !stateNames.has(m[1])) continue;
        const rhs = m[4];
        const rhsWords = expandWords(rhs, defs);
        let token: string | undefined;
        const direct = findTokenCalls(rhs).find((c) => c.method === 'balanceOf' && c.args.length === 1 && isSelf(c.args[0]));
        if (direct) token = direct.token;
        if (!token) for (const [local, t] of liveReads) if (rhsWords.has(local)) token = t;
        if (!token) for (const p of pulls) if (p.args[2] && words(p.args[2]).some((w) => rhsWords.has(w))) token = p.token;
        if (!token) continue;
        const share = SHARE_NAME.test(m[1]) || SHARE_CONVERT.test([...rhsWords].join(' ')) || SHARE_CONVERT.test(rhs);
        const list = stores.get(m[1]) ?? [];
        list.push({ root: m[1], line: s.line, fn, token, share });
        stores.set(m[1], list);
      }
    }

    // 2. Settlements: later payouts of the same token tied to the stored variable.
    for (const [root, storeList] of stores) {
      const token = storeList[0].token;
      const settled: { fn: SolFunction; line: number; live: boolean }[] = [];
      for (const { fn, statements, defs } of prepared) {
        const mentioning = statements.filter((s) => new RegExp(`(?<![\\w$.])${root.replace(/\$/g, '\\$')}(?![\\w$])`).test(s.text));
        if (mentioning.length === 0) continue;
        const candidates = new Set([...fn.params.map((p) => p.name).filter(Boolean), ...defs.keys()]);
        for (const s of statements) {
          for (const c of findTokenCalls(s.text)) {
            if (!/^(?:safeT|t)ransfer$/.test(c.method) || c.token !== token || c.args.length < 2) continue;
            const amount = c.args[1];
            const aw = expandWords(amount, defs);
            const linked =
              aw.has(root) ||
              mentioning.some((ms) => words(ms.text).some((w) => candidates.has(w) && words(amount).includes(w)));
            if (!linked) continue;
            const live = LIVE_BALANCE.test([...aw].join(' ') + ' ' + amount) || [...defs].some(([k, v]) => aw.has(k) && (LIVE_BALANCE.test(v) || SHARE_CONVERT.test(v))) || SHARE_CONVERT.test(amount);
            settled.push({ fn, line: s.line, live });
          }
        }
      }

      const base = {
        contract: model.contract.name,
        variable: root,
        token,
        storedIn: storeList.map((s) => ({ function: s.fn.name, line: s.line })),
        settledIn: settled.map((s) => ({ function: s.fn.name, line: s.line })),
      };
      const settleStale = settled.filter((s) => !s.live);
      const guard = storeList.some((s) => guardedFns.has(s.fn));
      const optionExcluded = nonRebasing.has(token);
      if (storeList.every((s) => s.share) || (settled.length > 0 && settleStale.length === 0)) {
        tracked.push({ ...base, status: 'share-based', reason: 'share-based accounting or payout from the live balance' });
        continue;
      }
      if (documentedExclusion || guard || optionExcluded) {
        tracked.push({ ...base, status: 'excluded', reason: documentedExclusion ? 'documented rebasing exclusion' : guard ? 'on-chain rebasing guard' : 'nonRebasingTokens option' });
        continue;
      }
      if (settleStale.length === 0) {
        tracked.push({ ...base, status: 'unsettled' });
        continue;
      }
      tracked.push({ ...base, status: 'stale-risk' });

      const first = storeList.find((s) => !s.share) ?? storeList[0];
      const storeFn = first.fn;
      const arbitrary = storeFn.params.some((p) => p.name && new RegExp(`^${p.name.replace(/\$/g, '\\$')}\\b`).test(token));
      const known = KNOWN_REBASING.test(token);
      const stable = STABLE_NAME.test(token);
      const [severity, confidence, why]: [SecurityFinding['severity'], SecurityFinding['confidence'], string] = known
        ? ['high', 'high', `the token name (${token}) matches a known rebasing asset`]
        : arbitrary
          ? ['high', 'medium', `${storeFn.name}() accepts any token, so a caller can choose a rebasing one`]
          : stable
            ? ['low', 'low', `${token} looks like a non-rebasing asset, but the contract does not enforce it`]
            : ['medium', 'medium', `${token} is a fixed token whose rebasing behavior is not visible`];
      findings.push(
        makeFinding(source, storeFn.offset, {
          ruleId: RULE_ID,
          kind: 'stale-stored-balance',
          severity,
          confidence,
          contract: model.contract.name,
          function: storeFn.name,
          message: `${root} stores a ${token} amount (line ${first.line}) that ${settleStale.map((s) => `${s.fn.name}() (line ${s.line})`).join(', ')} later pays out; a rebase of ${token} makes this claim stale.`,
          severityRationale:
            'A negative rebase leaves the contract owing more than it holds, so early withdrawers take the others\' funds; a positive rebase locks the surplus. ' + `Severity ${severity}: ${why}.`,
          confidenceEvidence: [
            `${root} is written from a ${token} amount at line ${first.line}`,
            ...settleStale.map((s) => `${s.fn.name}() pays out ${token} using it at line ${s.line}`),
            'no share conversion, live-balance payout, rebasing guard or documented exclusion found',
            why,
          ],
          remediation: `Track shares (or measure balanceOf(address(this)) at settlement time and pay pro-rata), or reject rebasing tokens explicitly: add "// gasguard-no-rebasing: <reason>" and an on-chain allow-list/guard.`,
          details: { variable: root, token, storedIn: base.storedIn, settledIn: base.settledIn },
        }),
      );
    }
  }
  return { ruleId: RULE_ID, analyzed: true, findings, diagnostics, tracked };
}
