/**
 * GG-SIG-RECOVERY-001: unsafe signature recovery and malleable ECDSA handling.
 *
 * For every raw `ecrecover(hash, v, r, s)` call the rule checks the three
 * validations a consumer has to do itself:
 *
 *   s bound     `s` is rejected above the secp256k1 half order (EIP-2), otherwise
 *               (v, r, s) and (v', r, n - s) are two valid signatures of one message
 *   v value     `v` is checked to be 27 or 28
 *   zero signer the recovered address is checked against address(0), because
 *               ecrecover returns 0 for invalid input instead of reverting
 *
 * It also flags `keccak256(signature)` used as an identifier: a malleable
 * signature produces a second hash and bypasses a used-signature mapping.
 *
 * Supported: Solidity 0.6 - 0.8.x, single file, checks done in the same
 * function. Libraries such as OpenZeppelin ECDSA.recover are not flagged.
 * Checks done in a called helper or modifier are not followed.
 * See docs/rules/sig-ecdsa-malleability.md.
 */

import {
  type Diagnostic,
  type RuleResult,
  type SecurityFinding,
  extractContracts,
  extractFunctions,
  findMatching,
  makeFinding,
  mentions,
  prepareSource,
  splitTopLevel,
  statementsOf,
} from '../lib/solidity-lite';

export const RULE_ID = 'GG-SIG-RECOVERY-001';

export const LIMITATIONS = [
  'Only raw ecrecover calls are analyzed; ecrecover through inline assembly or a staticcall to address 1 is not seen.',
  'Validation inside a called helper or an inherited modifier is not followed, so it can be reported as missing.',
  'Library recovery (ECDSA.recover, SignatureChecker) is assumed to validate s and v and is never flagged.',
];

const GUARD_RE = /\b(require|assert|if)\b/;
const HALF_ORDER_RE = /0x7[fF]{3}[0-9A-Fa-f_]*|HALF|N_DIV_2|SECP256K1N|S_MAX|MAX_S\b/;
const V_VALUE_RE = /\b(27|28)\b|0x1[bB]|0x1[cC]/;
const SIG_ID_RE = /keccak256\s*\(\s*(?:abi\.encodePacked\s*\(\s*)?([A-Za-z_$][\w$]*)\s*\)/g;
const SIG_NAME_RE = /^_?(sig|signature)\w*$/i;
const PLAIN_IDENT_RE = /^[A-Za-z_$][\w$]*$/;

export function detectEcdsaMalleability(input: unknown): RuleResult {
  const prep = prepareSource(input);
  if (!prep.ok) return { ruleId: RULE_ID, analyzed: false, findings: [], diagnostics: prep.diagnostics };
  const { source, masked } = prep.prepared;
  const diagnostics: Diagnostic[] = [...prep.diagnostics];
  const findings: SecurityFinding[] = [];

  try {
    const contracts = extractContracts(masked, diagnostics);
    const functions = extractFunctions(masked, source, contracts, diagnostics);

    for (const fn of functions) {
      if (fn.kind !== 'function' || !fn.hasBody) continue;
      const stmts = statementsOf(fn, source);
      const guards = stmts.filter((s) => GUARD_RE.test(s.text));
      const base = { ruleId: RULE_ID, contract: fn.contract, function: fn.name };
      const recovers = /\becrecover\s*\(|\.\s*(?:try)?[rR]ecover\s*\(/.test(fn.body);

      const callRe = /\becrecover\s*\(/g;
      let m: RegExpExecArray | null;
      while ((m = callRe.exec(fn.body)) !== null) {
        const open = m.index + m[0].length - 1;
        const close = findMatching(fn.body, open, '(', ')');
        if (close === -1) {
          diagnostics.push({ level: 'warning', code: 'unbalanced-ecrecover', message: 'ecrecover call is not terminated.', line: fn.line });
          break;
        }
        const args = splitTopLevel(fn.body.slice(open + 1, close)).map((a) => a.trim());
        if (args.length !== 4) continue;
        const [, vArg, , sArg] = args;
        const offset = fn.bodyOffset + m.index;
        const stmt = stmts.find((s) => offset >= s.offset && offset < s.offset + s.text.length);
        const sVar = PLAIN_IDENT_RE.test(sArg) ? sArg : undefined;
        const vVar = PLAIN_IDENT_RE.test(vArg) ? vArg : undefined;

        const sBounded = guards.some((g) => HALF_ORDER_RE.test(g.text) && (!sVar || mentions(g.text, sVar)));
        const vChecked = guards.some((g) => V_VALUE_RE.test(g.text) && (!vVar || mentions(g.text, vVar)));

        if (!sBounded) {
          findings.push(
            makeFinding(source, offset, {
              ...base,
              kind: 'missing-s-upper-bound',
              severity: 'medium',
              confidence: 'high',
              message: `${fn.name}() calls ecrecover without rejecting s above the secp256k1 half order, so every signature has a second valid form (v flipped, s = n - s).`,
              severityRationale: 'A malleable signature breaks any logic that treats the signature bytes as unique, such as replay or used-signature tracking.',
              confidenceEvidence: ['raw ecrecover call', sVar ? `no guard bounds ${sVar} against the half order` : 'no guard compares s with the half order'],
              remediation: 'Require s <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0 or use OpenZeppelin ECDSA.recover.',
              details: { sArgument: sArg },
            }),
          );
        }
        if (!vChecked) {
          findings.push(
            makeFinding(source, offset, {
              ...base,
              kind: 'missing-v-check',
              severity: 'low',
              confidence: 'high',
              message: `${fn.name}() calls ecrecover without checking that v is 27 or 28.`,
              severityRationale: 'ecrecover returns address(0) for other v values; the impact depends on the zero-address handling.',
              confidenceEvidence: ['raw ecrecover call', vVar ? `no guard compares ${vVar} with 27 or 28` : 'no guard compares v with 27 or 28'],
              remediation: 'Require v == 27 || v == 28 before calling ecrecover.',
              details: { vArgument: vArg },
            }),
          );
        }

        const returned = stmt ? /^return\b/.test(stmt.text) : false;
        if (returned) continue;
        const recoveredVar = stmt ? /([A-Za-z_$][\w$]*)\s*=\s*ecrecover\s*\(/.exec(stmt.text)?.[1] : undefined;
        const inlineZero = stmt ? /ecrecover\s*\([^;]*\)\s*[!=]=\s*address\s*\(\s*0\s*\)/.test(stmt.text) : false;
        const zeroChecked =
          inlineZero ||
          (!!recoveredVar && guards.some((g) => mentions(g.text, recoveredVar) && /address\s*\(\s*0\s*\)/.test(g.text)));
        if (zeroChecked) continue;
        const compared =
          (!!recoveredVar && guards.some((g) => mentions(g.text, recoveredVar) && /[!=]=/.test(g.text))) ||
          (!!stmt && /ecrecover\s*\([^;]*\)\s*[!=]=/.test(stmt.text));
        findings.push(
          makeFinding(source, offset, {
            ...base,
            kind: 'missing-zero-address-check',
            severity: compared ? 'low' : 'medium',
            confidence: compared ? 'low' : 'medium',
            message: `${fn.name}() does not check the ecrecover result against address(0); an invalid signature recovers to the zero address instead of reverting.`,
            severityRationale: compared
              ? 'The result is compared with an expected signer, which only fails open if that signer can be address(0).'
              : 'The recovered address is never compared with anything, so any invalid signature is accepted.',
            confidenceEvidence: ['raw ecrecover call', recoveredVar ? `no guard compares ${recoveredVar} with address(0)` : 'result is not assigned to a variable that is checked'],
            remediation: 'Require the recovered address to be non-zero and equal to the expected signer.',
          }),
        );
      }

      if (recovers) {
        for (const st of stmts) {
          SIG_ID_RE.lastIndex = 0;
          let h: RegExpExecArray | null;
          while ((h = SIG_ID_RE.exec(st.text)) !== null) {
            if (!SIG_NAME_RE.test(h[1])) continue;
            findings.push(
              makeFinding(source, st.offset + h.index, {
                ...base,
                kind: 'signature-hash-as-identifier',
                severity: 'high',
                confidence: 'medium',
                message: `${fn.name}() hashes the raw signature bytes (${h[1]}); a malleated signature hashes differently and bypasses any used-signature check built on it.`,
                severityRationale: 'Replay protection keyed on signature bytes can be defeated by producing the second valid form of the same signature.',
                confidenceEvidence: [`keccak256(${h[1]})`, 'function also recovers a signer'],
                remediation: 'Key replay protection on the signed message hash or a nonce, never on the signature itself.',
                details: { signatureVariable: h[1] },
              }),
            );
          }
        }
      }
    }
  } catch {
    diagnostics.push({ level: 'error', code: 'internal-error', message: 'Analysis stopped on unsupported input; findings may be incomplete.' });
  }

  findings.sort((a, b) => a.line - b.line || a.column - b.column || a.kind.localeCompare(b.kind));
  return { ruleId: RULE_ID, analyzed: true, findings, diagnostics };
}
