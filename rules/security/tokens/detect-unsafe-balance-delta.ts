/**
 * GG-TOKEN-DELTA-001 — Unsafe ERC-20 balance-before / balance-after calculations.
 *
 * Tracks each `balanceOf(account)` read (token and account) and every subtraction of two reads,
 * then checks:
 *  - `mismatched-balance-reads`: the two reads use a different token or account, so the "delta"
 *    is not one balance moving;
 *  - `reversed-delta`: the subtraction order contradicts the transfer between the reads
 *    (an inflow must be `after - before`, an outflow `before - after`); when no transfer is visible
 *    the name of the result (`received`, `sent` ...) is used and the confidence drops;
 *  - `swapped-balance-reads`: variables named before/after are read in the opposite order;
 *  - `unrelated-balance-change`: the measured account is not touched by the transfer between the
 *    reads, or several transfers move it, so the delta includes changes the code did not cause;
 *  - `unchecked-balance-delta`: the subtraction sits in `unchecked {}` (or Solidity < 0.8) without
 *    an ordering guard, so a smaller-than-expected balance wraps around.
 *
 * Intentional patterns are accepted: signed deltas (`int256(after) - int256(before)`, `toInt256`,
 * an `int` result), ternaries, and an explicit comparison of the two reads in the function.
 * Under checked arithmetic a reversed delta reverts instead of wrapping, which lowers severity.
 *
 * Supported: Solidity 0.6 - 0.8.x, single source string. Transfers inside called functions are not
 * followed. No project scripts or configuration are executed. See docs/rules/token-balance-delta.md.
 */
import { Diagnostic, RuleResult, SecurityFinding, SolFunction, makeFinding, prepareSource, statementsOf } from '../lib/solidity-lite';
import { buildSourceModel } from '../lib/solidity-inheritance';
import { TokenCall, findTokenCalls, isSelf } from './token-calls';

export const RULE_ID = 'GG-TOKEN-DELTA-001';

export interface DeltaEntry {
  contract: string;
  function: string;
  line: number;
  token: string;
  account: string;
  form: 'after-before' | 'before-after';
  direction: 'inflow' | 'outflow' | 'mixed' | 'none' | 'unknown';
  status: 'ok' | 'intentional' | 'flagged';
  kind?: string;
}

export interface BalanceDeltaResult extends RuleResult {
  deltas: DeltaEntry[];
}

interface Read {
  name: string;
  token: string;
  account: string;
  index: number;
  line: number;
}

const BEFORE_NAME = /(before|prev|old|initial|start|pre)/i;
const AFTER_NAME = /(after|post|new|final|end|current|now)/i;
const IN_NAME = /(receiv|recv|amountin|deposit|added|gain|actual|got|credit)/i;
const OUT_NAME = /(sent|spent|out|withdrawn|paid|debit|removed|taken)/i;
const TRANSFER = /^(?:safeT|t)ransfer(?:From)?$/;

function account(expr: string): string {
  const e = expr.replace(/\s+/g, '').replace(/_msgSender\(\)/, 'msg.sender');
  if (isSelf(e)) return 'this';
  const m = /^address\((.*)\)$/.exec(e);
  return m && !/^this$/.test(m[1]) ? m[1] : e;
}

/** Accounts a transfer call changes: [account losing, account gaining]. */
function movement(c: TokenCall): { from: string; to: string } | null {
  if (!TRANSFER.test(c.method)) return null;
  if (/From$/.test(c.method)) return c.args.length >= 3 ? { from: account(c.args[0]), to: account(c.args[1]) } : null;
  return c.args.length >= 2 ? { from: 'this', to: account(c.args[0]) } : null;
}

function inUnchecked(fn: SolFunction, offset: number): boolean {
  const body = fn.body;
  const end = Math.max(0, offset - fn.bodyOffset);
  const stack: boolean[] = [];
  for (let i = 0; i < end && i < body.length; i++) {
    if (body[i] === '{') stack.push(/\bunchecked\s*$/.test(body.slice(Math.max(0, i - 15), i)));
    else if (body[i] === '}') stack.pop();
  }
  return stack.some(Boolean);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasSubtraction(text: string, left: string, right: string): boolean {
  return new RegExp(`\\b${escapeRegExp(left)}\\b\\s*-\\s*\\b${escapeRegExp(right)}\\b`).test(text);
}

function hasTwoSidedConditional(text: string, left: string, right: string): boolean {
  const question = text.indexOf('?');
  const colon = text.indexOf(':', question + 1);
  if (question === -1 || colon === -1) return false;
  const whenTrue = text.slice(question + 1, colon);
  const whenFalse = text.slice(colon + 1);
  return (
    (hasSubtraction(whenTrue, left, right) && hasSubtraction(whenFalse, right, left)) ||
    (hasSubtraction(whenTrue, right, left) && hasSubtraction(whenFalse, left, right))
  );
}

function hasOrderingGuard(fn: SolFunction, offset: number, minuend: string, subtrahend: string): boolean {
  const end = Math.max(0, offset - fn.bodyOffset);
  const before = fn.body.slice(0, end);
  const guardedCall = /\b(?:require|assert)\s*\((?:[^()]|\([^()]*\))*\)\s*;/g;
  const comparison = new RegExp(
    `\\b${escapeRegExp(minuend)}\\b\\s*>=\\s*\\b${escapeRegExp(subtrahend)}\\b`,
  );
  let match: RegExpExecArray | null;
  while ((match = guardedCall.exec(before)) !== null) {
    if (comparison.test(match[0])) return true;
  }
  return false;
}

export function detectUnsafeBalanceDelta(input: unknown): BalanceDeltaResult {
  const prep = prepareSource(input);
  if (!prep.ok) return { ruleId: RULE_ID, analyzed: false, findings: [], diagnostics: prep.diagnostics, deltas: [] };
  const { source, masked } = prep.prepared;
  const diagnostics: Diagnostic[] = [...prep.diagnostics];
  const pragma = /pragma\s+solidity\s+([^;]+);/.exec(masked)?.[1] ?? '';
  const preSol8 = /(^|[^\d.])0\.[0-7]\./.test(pragma) && !/0\.8\./.test(pragma);

  const src = buildSourceModel(masked, source, diagnostics);
  const findings: SecurityFinding[] = [];
  const deltas: DeltaEntry[] = [];
  const seen = new Set<string>();

  for (const model of src.contracts.values()) {
    if (model.contract.kind !== 'contract') continue;
    for (const fn of model.functions) {
      if (fn.contract !== model.contract.name || (fn.kind !== 'function' && fn.kind !== 'receive' && fn.kind !== 'fallback')) continue;
      const statements = statementsOf(fn, source);
      const calls = statements.map((s) => findTokenCalls(s.text));
      const reads: Read[] = [];

      // Local variables that hold a balanceOf(account) read.
      statements.forEach((s, index) => {
        const m = /^(?:[A-Za-z_$][\w$]*\s+)?([A-Za-z_$][\w$]*)\s*=(?!=)\s*([\s\S]+)$/.exec(s.text);
        if (!m) return;
        const rhs = m[2].trim();
        const only = findTokenCalls(rhs);
        if (only.length === 1 && only[0].method === 'balanceOf' && only[0].args.length === 1 && only[0].index === 0 && only[0].end === rhs.length) {
          reads.push({ name: m[1], token: only[0].token, account: account(only[0].args[0]), index, line: s.line });
        }
      });

      statements.forEach((s, i) => {
        // Replace inline balanceOf calls by placeholders so they can be subtracted like locals.
        let text = s.text;
        const bal = calls[i].filter((c) => c.method === 'balanceOf' && c.args.length === 1 && !reads.some((r) => r.index === i));
        const inline: Read[] = bal.map((c, k) => ({ name: `__R${k}`, token: c.token, account: account(c.args[0]), index: i, line: s.line }));
        for (let k = bal.length - 1; k >= 0; k--) text = text.slice(0, bal[k].index) + ` __R${k} ` + text.slice(bal[k].end);
        const signed = /\bint\d*\s*\(|toInt\d*\s*\(|^\s*int\d*\s/.test(s.text);
        text = text.replace(/\b(?:u?int\d*|SafeCast\.\w+)\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g, '$1');
        const resolve = (name: string): Read | undefined => {
          const p = /^__R(\d+)$/.exec(name);
          if (p) return inline[Number(p[1])];
          return [...reads].reverse().find((r) => r.name === name && r.index < i);
        };
        const re = /([A-Za-z_$][\w$]*)\s*-\s*([A-Za-z_$][\w$]*)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          const minuend = resolve(m[1]);
          const sub = resolve(m[2]);
          if (!minuend || !sub) continue;
          const key = `${fn.offset}:${s.line}:${m[1]}:${m[2]}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const lhs = /^(?:(u?int\d*)\s+)?([A-Za-z_$][\w$]*)\s*=(?!=)/.exec(s.text);
          const resultName = lhs?.[2] ?? '';
          const intentional = signed || (lhs?.[1] ?? '').startsWith('int') || hasTwoSidedConditional(text, m[1], m[2]);
          const earlier = minuend.index <= sub.index ? minuend : sub;
          const later = earlier === minuend ? sub : minuend;
          const form: DeltaEntry['form'] = earlier === sub ? 'after-before' : 'before-after';
          const sameStatement = minuend.index === sub.index;

          // Transfers of the measured token between the two reads.
          const sameBalance = minuend.token === sub.token && minuend.account === sub.account;
          const between: { from: string; to: string }[] = [];
          if (!sameStatement) {
            for (let k = earlier.index + 1; k < later.index; k++) {
              for (const c of calls[k]) {
                const mv = movement(c);
                if (mv && c.token === minuend.token) between.push(mv);
              }
            }
          }
          const anyMove = !sameStatement && calls.slice(earlier.index + 1, later.index).some((cs) => cs.some((c) => movement(c)));
          const hint = BEFORE_NAME.test(m[1] + m[2]) || AFTER_NAME.test(m[1] + m[2]) || IN_NAME.test(resultName) || OUT_NAME.test(resultName);
          const acct = minuend.account;
          const gains = between.filter((t) => t.to === acct).length;
          const losses = between.filter((t) => t.from === acct).length;
          const direction: DeltaEntry['direction'] = !sameBalance || sameStatement ? 'unknown' : between.length === 0 ? 'none' : gains && losses ? 'mixed' : gains ? 'inflow' : losses ? 'outflow' : 'none';

          const unchecked = preSol8 || inUnchecked(fn, s.offset);
          const found: { kind: string; severity: SecurityFinding['severity']; confidence: SecurityFinding['confidence']; message: string; why: string; evidence: string[]; fix: string }[] = [];
          const after = form === 'after-before' ? minuend : sub;
          const before = form === 'after-before' ? sub : minuend;

          if (!sameBalance) {
            const parts = [minuend.token !== sub.token ? `tokens ${minuend.token} vs ${sub.token}` : '', minuend.account !== sub.account ? `accounts ${minuend.account} vs ${sub.account}` : ''].filter(Boolean);
            if (anyMove || hint) {
              found.push({
                kind: 'mismatched-balance-reads', severity: 'high', confidence: 'medium',
                message: `${m[1]} - ${m[2]} subtracts balances that are not the same balance (${parts.join('; ')}), so the result is not the amount that moved.`,
                why: 'The computed amount is credited or paid out, and an attacker can change the unrelated balance (for example by donating tokens) to inflate it; severity high.',
                evidence: [`${earlier.name}: ${earlier.token}.balanceOf(${earlier.account}) at line ${earlier.line}`, `${later.name}: ${later.token}.balanceOf(${later.account}) at line ${later.line}`],
                fix: 'Read the same token and the same account before and after the transfer.',
              });
            }
          } else if (!sameStatement) {
            const swapped = AFTER_NAME.test(earlier.name) && BEFORE_NAME.test(later.name) && !BEFORE_NAME.test(earlier.name) && !AFTER_NAME.test(later.name);
            const expected = direction === 'inflow' ? 'after-before' : direction === 'outflow' ? 'before-after' : IN_NAME.test(resultName) ? 'after-before' : OUT_NAME.test(resultName) ? 'before-after' : null;
            if (swapped) {
              found.push({
                kind: 'swapped-balance-reads', severity: 'low', confidence: 'medium',
                message: `${earlier.name} is read before ${later.name} (lines ${earlier.line} and ${later.line}), the opposite of what their names say.`,
                why: 'The names mislead reviewers and the subtraction is likely to be the wrong way round; severity low.',
                evidence: [`${earlier.name} at line ${earlier.line}`, `${later.name} at line ${later.line}`],
                fix: 'Take the "before" read first and the "after" read after the transfer.',
              });
            } else if (!intentional && expected && form !== expected) {
              const known = direction === 'inflow' || direction === 'outflow';
              found.push({
                kind: 'reversed-delta', severity: unchecked ? 'high' : 'medium', confidence: known ? 'high' : 'low',
                message: `${m[1]} - ${m[2]} computes ${form === 'after-before' ? 'after - before' : 'before - after'}, but ${known ? `the transfer between the reads is an ${direction}` : `the result name "${resultName}" implies ${expected === 'after-before' ? 'an inflow' : 'an outflow'}`}; expected ${expected === 'after-before' ? 'after - before' : 'before - after'}.`,
                why: unchecked ? 'Under unchecked arithmetic (or Solidity < 0.8) the reversed subtraction wraps to a huge amount that can be credited; severity high.' : 'Under checked arithmetic the reversed subtraction reverts whenever the balance moves as expected, bricking the path, or yields the wrong sign; severity medium.',
                evidence: [`before: ${before.token}.balanceOf(${before.account}) at line ${before.line}`, `after: ${after.token}.balanceOf(${after.account}) at line ${after.line}`, `direction: ${direction}`, `checked arithmetic: ${unchecked ? 'no' : 'yes'}`],
                fix: `Compute ${expected === 'after-before' ? 'after - before' : 'before - after'}, or use a signed delta on purpose (int256 casts) and handle both signs.`,
              });
            }
            if (!intentional && between.length > 0) {
              const touching = gains + losses;
              if (touching === 0 || touching > 1 || direction === 'mixed') {
                found.push({
                  kind: 'unrelated-balance-change', severity: 'medium', confidence: touching === 0 ? 'high' : 'medium',
                  message: touching === 0
                    ? `The transfer between the reads does not touch ${acct}; the ${acct} balance delta measures changes the code did not cause.`
                    : `${touching} transfers move the ${acct} balance between the reads, so the delta mixes several flows.`,
                  why: 'A delta that includes unrelated movements (donations, other transfers, hooks) can be manipulated by a third party; severity medium.',
                  evidence: between.map((t) => `${t.from} -> ${t.to}`),
                  fix: `Measure the balance of the account that actually sends or receives the tokens in this transfer, and isolate the call between the two reads.`,
                });
              }
            }
            if (
              !intentional &&
              unchecked &&
              form === 'after-before' &&
              !hasOrderingGuard(fn, s.offset, m[1], m[2]) &&
              !found.some((f) => f.kind === 'reversed-delta')
            ) {
              found.push({
                kind: 'unchecked-balance-delta', severity: 'low', confidence: 'low',
                message: `after - before at line ${s.line} runs without overflow checks and without an ordering guard; a balance that ends lower than it started wraps around.`,
                why: 'A negative rebase, a transfer hook or a fee can make the balance fall; wrapped arithmetic then reports a huge gain; severity low because it needs an unusual token.',
                evidence: [`unchecked: ${preSol8 ? 'Solidity < 0.8' : 'unchecked block'}`],
                fix: 'Remove unchecked, or require(after >= before) before subtracting.',
              });
            }
          }

          deltas.push({
            contract: model.contract.name, function: fn.name, line: s.line, token: minuend.token, account: minuend.account, form, direction,
            status: found.length > 0 ? 'flagged' : intentional ? 'intentional' : 'ok', kind: found[0]?.kind,
          });
          for (const f of found) {
            findings.push(
              makeFinding(source, s.offset, {
                ruleId: RULE_ID, kind: f.kind, severity: f.severity, confidence: f.confidence, contract: model.contract.name, function: fn.name,
                message: f.message, severityRationale: f.why, confidenceEvidence: f.evidence, remediation: f.fix,
                details: { token: minuend.token, account: minuend.account, form, direction, intentional },
              }),
            );
          }
        }
      });
    }
  }
  return { ruleId: RULE_ID, analyzed: true, findings, diagnostics, deltas };
}
