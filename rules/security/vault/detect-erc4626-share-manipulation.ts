/**
 * GG-VAULT-4626-001: ERC-4626 accounting and share-price manipulation.
 *
 * Looks at contracts that expose `totalAssets` together with deposit or share
 * conversion logic and reports:
 *
 *   spot-balance-total-assets   totalAssets reads the live token balance of the
 *                               vault, so a direct donation moves the share price
 *   unmitigated-first-depositor shares are priced as assets * supply / totalAssets
 *                               with no virtual offset and no dead shares, which
 *                               allows the classic first-depositor inflation
 *   unchecked-zero-shares       deposit mints shares that can round down to zero
 *                               without reverting
 *
 * Supported: Solidity 0.6 - 0.8.x, single file, one contract at a time.
 * A contract that inherits OpenZeppelin ERC4626 and does not override the
 * conversion functions relies on the library and is not reported for the
 * first-depositor kind. Helpers and inherited code are not followed.
 * See docs/rules/vault-erc4626-share-manipulation.md.
 */

import {
  type Diagnostic,
  type RuleResult,
  type SecurityFinding,
  type SolFunction,
  extractContracts,
  extractFunctions,
  makeFinding,
  mentions,
  prepareSource,
  statementsOf,
} from '../lib/solidity-lite';

export const RULE_ID = 'GG-VAULT-4626-001';

export const LIMITATIONS = [
  'Analysis is lexical and per contract; inherited conversion logic and library helpers are not followed.',
  'A mitigation is recognised only in the forms listed in the rule documentation (decimals offset, virtual shares, dead shares).',
  'Accounting that is tracked in a state variable is treated as safe from donations without verifying every write to it.',
];

const SPOT_BALANCE_RE = /\bbalanceOf\s*\(\s*address\s*\(\s*this\s*\)\s*\)|\baddress\s*\(\s*this\s*\)\s*\.\s*balance\b/;
const TOTAL_ASSETS_RE = /\btotalAssets\s*\(\s*\)|\b_?totalAssets\b|\btotalManaged\w*|\btotalDeposits\b/;
const SUPPLY_RE = /\btotalSupply\s*\(\s*\)|\b_?totalSupply\b|\btotalShares\b|\bsupply\b/;
const DEAD_SHARES_RE = /_mint\s*\(\s*(?:address\s*\(\s*0\s*\)|address\s*\(\s*0x0*dEaD\w*\s*\)|DEAD\w*|0x0*dEaD\w*)|\b(?:MINIMUM_LIQUIDITY|MINIMUM_SHARES|DEAD_SHARES|MIN_SHARES)\b/i;
const VIRTUAL_RE = /\b_decimalsOffset\s*\(\s*\)[^{]*\{\s*return\s+[1-9]\d*|\+\s*10\s*\*\*\s*\w+|\b(?:totalAssets\s*\(\s*\)|totalSupply\s*\(\s*\))\s*\+\s*1\b|\bVIRTUAL_\w+/;
const ZERO_GUARD_RE = /(>\s*0|!=\s*0|0\s*<|0\s*!=|ZERO_SHARES|ZeroShares|InsufficientShares)/;
const CONVERSION_NAMES = new Set(['convertToShares', '_convertToShares', 'previewDeposit', 'deposit', '_deposit', 'previewMint']);
const DEPOSIT_NAMES = new Set(['deposit', '_deposit', 'depositFor']);

function isVault(fns: SolFunction[], bases: string[]): boolean {
  const names = new Set(fns.map((f) => f.name));
  return (
    names.has('totalAssets') &&
    (names.has('deposit') || names.has('mint') || names.has('convertToShares') || names.has('previewDeposit'))
  ) || (bases.some((b) => /ERC4626/.test(b)) && names.has('totalAssets'));
}

export function detectErc4626ShareManipulation(input: unknown): RuleResult {
  const prep = prepareSource(input);
  if (!prep.ok) return { ruleId: RULE_ID, analyzed: false, findings: [], diagnostics: prep.diagnostics };
  const { source, masked } = prep.prepared;
  const diagnostics: Diagnostic[] = [...prep.diagnostics];
  const findings: SecurityFinding[] = [];

  try {
    const contracts = extractContracts(masked, diagnostics);
    const functions = extractFunctions(masked, source, contracts, diagnostics);

    for (const c of contracts) {
      if (c.kind !== 'contract') continue;
      const fns = functions.filter((f) => f.contract === c.name && f.kind === 'function' && f.hasBody);
      if (!isVault(fns, c.bases)) continue;
      const text = masked.slice(c.open, Math.min(c.close, masked.length));
      const mitigated = DEAD_SHARES_RE.test(text) || VIRTUAL_RE.test(text);
      const base = { ruleId: RULE_ID, contract: c.name };

      const totalAssets = fns.find((f) => f.name === 'totalAssets' || f.name === '_totalAssets');
      const spot = totalAssets ? SPOT_BALANCE_RE.exec(totalAssets.body) : null;
      if (totalAssets && spot) {
        findings.push(
          makeFinding(source, totalAssets.bodyOffset + spot.index, {
            ...base,
            function: totalAssets.name,
            kind: 'spot-balance-total-assets',
            severity: mitigated ? 'low' : 'high',
            confidence: 'high',
            message: `${totalAssets.name}() reads the live token balance of the vault, so a direct transfer to the vault changes the share price without minting shares.`,
            severityRationale: mitigated
              ? 'A virtual offset or dead shares limit the profit from a donation, but the share price is still externally movable.'
              : 'Donating assets inflates the price per share, which lets an attacker round later depositors down to zero shares.',
            confidenceEvidence: ['totalAssets uses balanceOf(address(this)) or address(this).balance', mitigated ? 'a mitigation was found in the contract' : 'no virtual offset or dead shares found'],
            remediation: 'Track deposited assets in an internal accounting variable instead of reading the raw balance, or add a decimals offset.',
          }),
        );
      }

      if (!mitigated) {
        const conv = fns.find((f) => {
          if (!CONVERSION_NAMES.has(f.name)) return false;
          const b = f.body;
          return /\//.test(b) && SUPPLY_RE.test(b) && (TOTAL_ASSETS_RE.test(b) || SPOT_BALANCE_RE.test(b));
        });
        if (conv) {
          const stmt = statementsOf(conv, source).find((s) => /\//.test(s.text) && SUPPLY_RE.test(s.text));
          const bootstrap = /(supply|totalSupply\s*\(\s*\)|totalShares)\s*==\s*0/.test(conv.body);
          findings.push(
            makeFinding(source, stmt ? stmt.offset : conv.offset, {
              ...base,
              function: conv.name,
              kind: 'unmitigated-first-depositor',
              severity: bootstrap ? 'high' : 'medium',
              confidence: bootstrap ? 'high' : 'medium',
              message: `${conv.name}() prices shares as assets * supply / totalAssets with no virtual offset or dead shares, so the first depositor can inflate the price and make later deposits round to zero shares.`,
              severityRationale: 'First-depositor inflation steals later deposits; it needs only one small deposit and a donation.',
              confidenceEvidence: ['share conversion divides by total assets', bootstrap ? 'an empty-vault branch bootstraps the first price' : 'no empty-vault branch seen', 'no decimals offset, virtual shares or dead-share mint found'],
              remediation: 'Add a decimals offset (virtual shares and assets), mint dead shares on the first deposit, or enforce a minimum initial deposit.',
            }),
          );
        }
      }

      for (const fn of fns) {
        if (!DEPOSIT_NAMES.has(fn.name)) continue;
        const stmts = statementsOf(fn, source);
        for (const st of stmts) {
          const asg = /(?:uint\d*\s+)?([A-Za-z_$][\w$]*)\s*=\s*([^;]*)/.exec(st.text);
          if (!asg || !/share/i.test(asg[1]) || !(/\//.test(asg[2]) || /\b(convertToShares|previewDeposit)\s*\(/.test(asg[2]))) continue;
          const v = asg[1];
          const minted = stmts.some((s) => /\b_?mint\s*\(/.test(s.text) && mentions(s.text, v));
          if (!minted) continue;
          const guarded = stmts.some((s) => /\b(require|assert|if)\b/.test(s.text) && mentions(s.text, v) && ZERO_GUARD_RE.test(s.text));
          if (guarded) continue;
          findings.push(
            makeFinding(source, st.offset, {
              ...base,
              function: fn.name,
              kind: 'unchecked-zero-shares',
              severity: 'medium',
              confidence: 'medium',
              message: `${fn.name}() mints ${v} without checking that it is non-zero, so a deposit can be accepted for zero shares after rounding down.`,
              severityRationale: 'The depositor loses the assets while receiving nothing, and a manipulated share price makes this cheap to trigger.',
              confidenceEvidence: [`${v} is computed with a division or a conversion call`, `${v} reaches mint without a zero guard`],
              remediation: `Revert when ${v} == 0 before minting.`,
              details: { sharesVariable: v },
            }),
          );
        }
      }
    }
  } catch {
    diagnostics.push({ level: 'error', code: 'internal-error', message: 'Analysis stopped on unsupported input; findings may be incomplete.' });
  }

  findings.sort((a, b) => a.line - b.line || a.column - b.column || a.kind.localeCompare(b.kind));
  return { ruleId: RULE_ID, analyzed: true, findings, diagnostics };
}
