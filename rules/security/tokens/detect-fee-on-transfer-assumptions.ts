/**
 * GG-TOKEN-FEE-001 — Accounting that assumes an ERC-20 transfer delivers exactly the requested amount (#1305).
 *
 * Fee-on-transfer (and deflationary or hook-taxing) tokens deliver less than `amount` to the receiver.
 * For each function the rule finds inflows `token.transferFrom(from, address(this), amount)` /
 * `safeTransferFrom` and follows the amount through local assignments to what the function does next:
 *  - `credited-requested-amount`: the requested amount is written to state (`deposits[user] += amount`,
 *    `totalDeposited += amount`) or minted (`_mint(user, amount)`) although the contract received less,
 *    which leaves the contract insolvent for the last withdrawers (medium; high when the amount is
 *    credited to a mapping entry or minted);
 *  - `forwarded-requested-amount`: the requested amount is forwarded to another call (`transfer`,
 *    `deposit`, `swap*`, `addLiquidity*`, `stake`, `supply`) so the call reverts, or pays out more than
 *    was received (low).
 * Recognized as safe, and not reported: the balance of the contract for the same token is read at least
 * twice in the function (the balance-before / balance-after pattern), and explicit exclusions: a
 * `@custom:no-fee-on-transfer`, `gasguard-no-fot` or "fee-on-transfer tokens are not supported" comment.
 * Whether the delta itself is computed correctly is the job of `GG-TOKEN-DELTA-001`.
 *
 * Supported: Solidity 0.6 - 0.8.x, single source string. Token behavior is not visible, so the finding is
 * a prompt for review: confidence is lower for well-known fixed tokens (usdc, weth, ...). Library-style
 * `SafeERC20.safeTransferFrom(token, from, to, amount)` calls are not recognized. No project scripts or
 * configuration are executed. See docs/rules/token-fee-on-transfer-assumptions.md.
 */
import { Diagnostic, RuleResult, SecurityFinding, makeFinding, prepareSource, statementsOf } from '../lib/solidity-lite';
import { buildSourceModel } from '../lib/solidity-inheritance';
import { expandWords, findTokenCalls, isSelf, localDefs } from './token-calls';

export const RULE_ID = 'GG-TOKEN-FEE-001';

export interface TokenInflow {
  contract: string;
  function: string;
  line: number;
  token: string;
  amount: string;
  status: 'measured' | 'excluded' | 'unused' | 'flagged';
  kind?: string;
}

export interface FeeOnTransferResult extends RuleResult {
  inflows: TokenInflow[];
}

const EXCLUSION_TEXT = /@custom:no-fee-on-transfer|gasguard-no-fot|(?:fee|tax)[- ]on[- ]transfer[^\n.]{0,60}(?:not supported|unsupported|not allowed|disallowed|excluded|incompatible)|(?:no|non|not|without)[- ]fee[- ]on[- ]transfer|deflationary[^\n.]{0,40}not supported/i;
const FIXED_TOKEN = /^(?:usdc|usdt|dai|weth|wbtc|wsteth|wbnb|wmatic)$/i;
const MINT_CALL = /(?<![\w$.])(?:_?mint|_?credit|_?addShares|_?issue)\s*\(([^;]*)\)/;
const FORWARD_CALL = /\.\s*(?:transfer|safeTransfer|deposit|supply|stake|swap\w*|addLiquidity\w*)\s*(?:\{[^}]*\})?\s*\(([^;]*)\)/;
const ASSIGN = /^\s*([A-Za-z_$][\w$]*)((?:\s*(?:\[[^\]]*\]|\.\s*[A-Za-z_$][\w$]*))*)\s*([-+])?=(?!=)\s*([\s\S]*)$/;
const IGNORED = new Set(['uint256', 'uint', 'address', 'this', 'msg', 'sender', 'value', 'true', 'false', 'return']);

const mentionsAny = (text: string, names: Set<string>) => (text.match(/[A-Za-z_$][\w$]*/g) ?? []).some((w) => names.has(w));

export function detectFeeOnTransferAssumptions(input: unknown): FeeOnTransferResult {
  const prep = prepareSource(input);
  if (!prep.ok) return { ruleId: RULE_ID, analyzed: false, findings: [], diagnostics: prep.diagnostics, inflows: [] };
  const { source, masked } = prep.prepared;
  const diagnostics: Diagnostic[] = [...prep.diagnostics];
  const src = buildSourceModel(masked, source, diagnostics);
  const findings: SecurityFinding[] = [];
  const inflows: TokenInflow[] = [];

  for (const model of src.contracts.values()) {
    if (model.contract.kind !== 'contract') continue;
    const name = model.contract.name;
    const stateNames = new Set(model.stateVars.filter((v) => !v.constant && !v.immutable).map((v) => v.name));
    const excluded = EXCLUSION_TEXT.test(source.slice(model.contract.open, model.contract.close)) ||
      EXCLUSION_TEXT.test(source.slice(Math.max(0, model.contract.open - 400), model.contract.open));

    for (const fn of model.functions) {
      if (fn.contract !== name || (fn.kind !== 'function' && fn.kind !== 'receive' && fn.kind !== 'fallback')) continue;
      const statements = statementsOf(fn, source);
      const calls = statements.map((s) => findTokenCalls(s.text));
      const defs = localDefs(statements.map((s) => s.text), (n) => stateNames.has(n));

      statements.forEach((s, i) => {
        for (const c of calls[i]) {
          if (!/^(?:safeT|t)ransferFrom$/.test(c.method) || c.args.length < 3 || !isSelf(c.args[1])) continue;
          const amount = c.args[2];
          const entry: TokenInflow = { contract: name, function: fn.name, line: s.line, token: c.token, amount, status: 'unused' };
          inflows.push(entry);

          const reads = calls.reduce((n, cs) => n + cs.filter((x) => x.method === 'balanceOf' && x.token === c.token && x.args.length === 1 && isSelf(x.args[0])).length, 0);
          if (reads >= 2) { entry.status = 'measured'; continue; }
          if (excluded) { entry.status = 'excluded'; continue; }

          const names = new Set([...expandWords(amount, defs)].filter((w) => !IGNORED.has(w) && !/^\d/.test(w)));
          if (names.size === 0) continue;
          const confidence: SecurityFinding['confidence'] = FIXED_TOKEN.test(c.token) ? 'low' : 'medium';
          const evidence = [`inflow: ${c.token}.${c.method}(…, address(this), ${amount}) at line ${s.line}`, `balanceOf(address(this)) reads of ${c.token} in the function: ${reads}`, `token identity: ${FIXED_TOKEN.test(c.token) ? 'well-known fixed token' : 'unknown or caller-supplied'}`];

          for (let j = i + 1; j < statements.length; j++) {
            const t = statements[j].text;
            const a = ASSIGN.exec(t);
            const stateWrite = a && a[3] !== '-' && stateNames.has(a[1]) && mentionsAny(a[4], names);
            const mint = MINT_CALL.exec(t);
            const minted = mint && mentionsAny(mint[1], names);
            if (stateWrite || minted) {
              const strong = minted || (a && /\[/.test(a[2]));
              findings.push(
                makeFinding(source, statements[j].offset, {
                  ruleId: RULE_ID, kind: 'credited-requested-amount', severity: strong ? 'high' : 'medium', confidence,
                  contract: name, function: fn.name,
                  message: `${fn.name} credits the requested ${[...names][0]} after ${c.token}.${c.method} without measuring what arrived; a fee-on-transfer token delivers less than requested.`,
                  severityRationale: strong
                    ? 'Per-account balances or shares are credited for tokens the contract never received, so the last withdrawers cannot be paid; severity high.'
                    : 'An aggregate counter exceeds the real balance, which skews pricing and withdrawals; severity medium.',
                  confidenceEvidence: [...evidence, `credit: ${t.replace(/\s+/g, ' ').slice(0, 80)} at line ${statements[j].line}`],
                  remediation: 'Read balanceOf(address(this)) before and after the transfer and credit the difference, or reject fee-on-transfer tokens explicitly.',
                  details: { token: c.token, amount, creditLine: statements[j].line, minted: Boolean(minted) },
                }),
              );
              entry.status = 'flagged';
              entry.kind = 'credited-requested-amount';
              break;
            }
            const fwd = FORWARD_CALL.exec(t);
            if (fwd && mentionsAny(fwd[1], names) && !calls[j].some((x) => x.method === 'balanceOf')) {
              findings.push(
                makeFinding(source, statements[j].offset, {
                  ruleId: RULE_ID, kind: 'forwarded-requested-amount', severity: 'low', confidence: 'low',
                  contract: name, function: fn.name,
                  message: `${fn.name} forwards the requested ${[...names][0]} to another call after ${c.token}.${c.method}; with a fee-on-transfer token the contract holds less and the call reverts or spends other users' tokens.`,
                  severityRationale: 'The failure mode is a revert (denial of service) or a payout from pooled funds; severity low because it depends on the token being taxed.',
                  confidenceEvidence: [...evidence, `forward: ${t.replace(/\s+/g, ' ').slice(0, 80)} at line ${statements[j].line}`],
                  remediation: 'Forward the measured balance difference instead of the requested amount.',
                  details: { token: c.token, amount, forwardLine: statements[j].line },
                }),
              );
              entry.status = 'flagged';
              entry.kind = 'forwarded-requested-amount';
              break;
            }
          }
        }
      });
    }
  }
  return { ruleId: RULE_ID, analyzed: true, findings, diagnostics, inflows };
}
