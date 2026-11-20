/**
 * GG-GAS-FORWARD-001 — Find unsafe assumptions about external call gas
 * forwarding.
 *
 * `address.transfer` / `address.send` forward a fixed 2300-gas stipend and
 * `call{gas: N}` forwards exactly N. Both encode an assumption about what the
 * recipient's `receive()`/fallback needs — an assumption that EVM repricing
 * (EIP-1884's SLOAD increase), proxies and contract wallets routinely break. The
 * rule inventories those calls and traces what happens when the recipient needs
 * more gas than assumed:
 *
 *   stipend-transfer                 transfer/send (implicit 2300 gas)
 *   fixed-gas-cap-reverts-on-failure `call{gas: N}` whose failure reverts the caller
 *   unchecked-low-level-send         failure of send/call is ignored
 *   intentional-gas-cap              a cap with the failure handled without reverting
 *                                    (e.g. credit a pull-payment balance) — recognized
 *                                    as deliberate, reported at low severity
 *
 * Severity follows the blast radius: a user withdrawing to `msg.sender` can only
 * lock themselves out; a third-party recipient whose failure reverts a shared
 * function — worst in a loop over many recipients — is a liveness hazard for
 * everyone. For every call the finding records the failure handling and how many
 * contract-state writes occur before and after it.
 *
 * Supported: Solidity 0.6 – 0.8.x, one file, intra-function; ERC-20 style
 * two-argument `transfer(to, amount)` is not an address transfer and is ignored.
 * Recipient code is never visible, so whether the cap is actually too low is a
 * question for the fixtures/tests of the recipient, not for this rule. See
 * docs/rules/oracle-configuration-and-gas-forwarding-security.md.
 */

import {
  Diagnostic,
  RuleResult,
  SecurityFinding,
  Severity,
  SolFunction,
  extractContracts,
  extractFunctions,
  extractStateVars,
  findEffects,
  findMatching,
  makeFinding,
  prepareSource,
  splitTopLevel,
  statementsOf,
} from '../lib/solidity-lite';

export const RULE_ID = 'GG-GAS-FORWARD-001';

export type FailureHandling = 'reverts' | 'handled' | 'ignored';

export interface GasCallSite {
  function: string;
  line: number;
  method: 'transfer' | 'send' | 'call' | 'staticcall' | 'delegatecall';
  recipient: string;
  recipientKind: 'self' | 'third-party';
  gas: { kind: 'stipend' | 'literal' | 'constant' | 'dynamic'; expression: string };
  inLoop: boolean;
  failure: FailureHandling;
  stateWritesBefore: number;
  stateWritesAfter: number;
}

export interface GasForwardingResult extends RuleResult {
  callSites: GasCallSite[];
}

const REVERT_RE = /\b(revert\b|require\s*\(\s*false|assert\s*\(\s*false)/;

function esc(n: string): string {
  return n.replace(/[$]/g, '\\$');
}

function inLoop(body: string, rel: number): boolean {
  let pos = rel;
  for (let guard = 0; guard < 64; guard++) {
    let depth = 0;
    let open = -1;
    for (let i = pos - 1; i >= 0; i--) {
      const c = body[i];
      if (c === '}') depth++;
      else if (c === '{') {
        if (depth === 0) {
          open = i;
          break;
        }
        depth--;
      }
    }
    if (open === -1) return false;
    if (/\b(for|while)\s*\([^{}]*\)\s*$/.test(body.slice(Math.max(0, open - 240), open))) return true;
    pos = open;
  }
  return false;
}

/** How is the success flag of a call handled in the statements that follow? */
function failureOf(fn: SolFunction, stmts: { text: string }[], index: number, text: string): FailureHandling {
  // Inline use: require(x.send(...)) / if (!x.send(...)) revert
  if (/^\s*(require|assert)\s*\(/.test(text)) return 'reverts';
  if (/^\s*if\s*\(\s*!/.test(text)) return REVERT_RE.test(text) || REVERT_RE.test(stmts[index + 1]?.text ?? '') ? 'reverts' : 'handled';
  const flag = /\(\s*bool\s+([A-Za-z_$][\w$]*)\s*(?:,[^)]*)?\)\s*=|\bbool\s+([A-Za-z_$][\w$]*)\s*=|^\s*\(\s*([A-Za-z_$][\w$]*)\s*,[^)]*\)\s*=|^\s*([A-Za-z_$][\w$]*)\s*=\s*[^=]/.exec(text);
  const name = flag?.[1] ?? flag?.[2] ?? flag?.[3] ?? flag?.[4];
  if (!name) return 'ignored';
  const n = esc(name);
  const rest = stmts.slice(index + 1).map((s) => s.text);
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (new RegExp(`^\\s*(require|assert)\\s*\\(\\s*${n}\\b`).test(t)) return 'reverts';
    if (new RegExp(`^\\s*if\\s*\\(\\s*!\\s*${n}\\s*\\)`).test(t)) {
      return REVERT_RE.test(t) || REVERT_RE.test(rest[i + 1] ?? '') ? 'reverts' : 'handled';
    }
    if (new RegExp(`^\\s*if\\s*\\(\\s*${n}\\s*\\)`).test(t)) return 'handled';
    if (new RegExp(`(?<![\\w$.])${n}(?![\\w$])`).test(t) && /\b(return|emit)\b|=/.test(t)) return 'handled';
  }
  void fn;
  return 'ignored';
}

export function detectGasForwardingAssumptions(input: unknown): GasForwardingResult {
  const prep = prepareSource(input);
  if (!prep.ok) return { ruleId: RULE_ID, analyzed: false, findings: [], diagnostics: prep.diagnostics, callSites: [] };
  const { source, masked } = prep.prepared;
  const diagnostics: Diagnostic[] = [...prep.diagnostics];
  const contracts = extractContracts(masked, diagnostics);
  const functions = extractFunctions(masked, source, contracts, diagnostics);
  const stateVars = extractStateVars(masked, source, contracts);
  const stateNames = new Set(stateVars.map((v) => v.name));
  const constants = new Set(stateVars.filter((v) => v.constant || v.immutable || /^[A-Z][A-Z0-9_]*$/.test(v.name)).map((v) => v.name));
  const findings: SecurityFinding[] = [];
  const callSites: GasCallSite[] = [];

  for (const fn of functions) {
    if (fn.kind === 'modifier' || !fn.hasBody) continue;
    const stmts = statementsOf(fn, source);
    const stateWrites = findEffects(fn, stateNames, source).filter((e) => e.kind === 'state-write').map((e) => e.statement.offset);

    stmts.forEach((st, index) => {
      const calls: { method: GasCallSite['method']; recipient: string; gas: GasCallSite['gas'] }[] = [];

      const simple = /((?:payable\s*\([^()]*\)|[A-Za-z_$][\w$]*(?:\[[^\]]*\])*(?:\.[A-Za-z_$][\w$]*(?:\[[^\]]*\])*)*))\s*\.\s*(transfer|send)\s*\(/g;
      let m: RegExpExecArray | null;
      while ((m = simple.exec(st.text)) !== null) {
        const open = m.index + m[0].length - 1;
        const close = findMatching(st.text, open, '(', ')');
        if (close === -1) continue;
        if (splitTopLevel(st.text.slice(open + 1, close)).filter((a) => a.trim()).length !== 1) continue; // ERC-20 transfer(to, amount)
        calls.push({ method: m[2] as 'transfer' | 'send', recipient: m[1].replace(/\s+/g, ''), gas: { kind: 'stipend', expression: '2300 (implicit)' } });
      }

      const low = /((?:payable\s*\([^()]*\)|[A-Za-z_$][\w$]*(?:\[[^\]]*\])*(?:\.[A-Za-z_$][\w$]*(?:\[[^\]]*\])*)*))\s*\.\s*(call|staticcall|delegatecall)\s*(\{([^}]*)\})?/g;
      while ((m = low.exec(st.text)) !== null) {
        const options = m[4] ?? '';
        const legacy = /^\s*\.\s*gas\s*\(\s*([^)]+)\)/.exec(st.text.slice(m.index + m[0].length));
        const g = /\bgas\s*:\s*([^,}]+)/.exec(options)?.[1]?.trim() ?? legacy?.[1]?.trim();
        if (!g) continue; // no explicit cap: all gas is forwarded
        const kind: GasCallSite['gas']['kind'] = /^\d[\d_]*$/.test(g) ? 'literal' : constants.has(g) ? 'constant' : 'dynamic';
        calls.push({ method: m[2] as GasCallSite['method'], recipient: m[1].replace(/\s+/g, ''), gas: { kind, expression: g } });
      }

      for (const c of calls) {
        const self = /^(payable\s*\(\s*)?msg\.sender\s*\)?$/.test(c.recipient);
        const loop = inLoop(fn.body, st.offset - fn.bodyOffset);
        const failure: FailureHandling = c.method === 'transfer' ? 'reverts' : failureOf(fn, stmts, index, st.text);
        const before = stateWrites.filter((o) => o < st.offset).length;
        const after = stateWrites.filter((o) => o > st.offset).length;
        const site: GasCallSite = {
          function: fn.name,
          line: st.line,
          method: c.method,
          recipient: c.recipient,
          recipientKind: self ? 'self' : 'third-party',
          gas: c.gas,
          inLoop: loop,
          failure,
          stateWritesBefore: before,
          stateWritesAfter: after,
        };
        callSites.push(site);
        const base = { ruleId: RULE_ID, contract: fn.contract, function: fn.name };
        const evidence = [
          `${c.recipient}.${c.method}(...) forwards ${c.gas.kind === 'stipend' ? 'the 2300-gas stipend' : `gas: ${c.gas.expression}`}`,
          `failure handling: ${failure}`,
          `recipient: ${site.recipientKind}${loop ? ', inside a loop' : ''}`,
          `state writes before/after the call: ${before}/${after}`,
        ];
        const details = { ...site };

        if (c.gas.kind === 'stipend') {
          let severity: Severity = self ? 'low' : loop ? 'high' : 'medium';
          if (failure === 'handled') severity = 'low';
          findings.push(
            makeFinding(source, st.offset, {
              ...base,
              kind: 'stipend-transfer',
              severity,
              confidence: 'high',
              message: `${fn.name}() uses ${c.method}() to ${self ? 'pay msg.sender' : 'pay a third party'}, forwarding a fixed 2300 gas${failure === 'reverts' ? ' and reverting on failure' : ''}${loop ? ' inside a loop' : ''}.`,
              severityRationale: self
                ? 'Only the caller is affected if their wallet needs more gas, but contract wallets and proxies often do (EIP-1884 repriced SLOAD).'
                : loop
                  ? 'One recipient that needs more than 2300 gas makes the whole loop revert, blocking every other recipient (denial of service).'
                  : 'A third-party recipient that needs more than 2300 gas permanently blocks this payment path.',
              confidenceEvidence: evidence,
              remediation: 'Use call{value: amount}("") with success checked (and reentrancy protection), or a pull-payment pattern where recipients withdraw their own funds.',
              details,
            }),
          );
          if (c.method === 'send' && failure === 'ignored') {
            findings.push(unchecked(source, st.offset, base, c.method, fn.name, before, evidence, details));
          }
          continue;
        }

        if (failure === 'ignored') {
          findings.push(unchecked(source, st.offset, base, c.method, fn.name, before, evidence, details));
          continue;
        }
        if (failure === 'handled') {
          findings.push(
            makeFinding(source, st.offset, {
              ...base,
              kind: 'intentional-gas-cap',
              severity: 'low',
              confidence: 'medium',
              message: `${fn.name}() caps forwarded gas at ${c.gas.expression}${c.gas.kind === 'constant' ? ' (named constant)' : ''} and handles failure without reverting; this looks like a deliberate cap.`,
              severityRationale: 'A capped call whose failure is handled gracefully (e.g. credited to a pull-payment balance) does not block the caller; the remaining risk is a cap that is too low for legitimate recipients.',
              confidenceEvidence: evidence,
              remediation: 'Document why the cap was chosen, make it configurable, and make sure a failed payout is retryable by the recipient.',
              details,
            }),
          );
          continue;
        }
        findings.push(
          makeFinding(source, st.offset, {
            ...base,
            kind: 'fixed-gas-cap-reverts-on-failure',
            severity: self ? 'low' : 'high',
            confidence: c.gas.kind === 'dynamic' ? 'low' : 'medium',
            message: `${fn.name}() forwards a fixed ${c.gas.expression} gas to ${self ? 'msg.sender' : 'a third party'} and reverts if the call fails${loop ? ' inside a loop' : ''}; a recipient that needs more gas makes ${loop ? 'the whole loop' : 'this path'} permanently fail.`,
            severityRationale: self
              ? 'Only the caller is locked out.'
              : 'An accidental gas ceiling combined with revert-on-failure turns recipient behavior into a liveness hazard for the function.',
            confidenceEvidence: evidence,
            remediation: 'Forward all remaining gas (call{value: amount}("")) with a success check, or handle failure without reverting (credit a pull-payment balance).',
            details,
          }),
        );
      }
    });
  }
  findings.sort((a, b) => a.line - b.line);
  return { ruleId: RULE_ID, analyzed: true, findings, diagnostics, callSites };
}

function unchecked(
  source: string,
  offset: number,
  base: { ruleId: string; contract?: string; function: string },
  method: string,
  fnName: string,
  writesBefore: number,
  evidence: string[],
  details: Record<string, unknown>,
): SecurityFinding {
  return makeFinding(source, offset, {
    ...base,
    kind: 'unchecked-low-level-send',
    severity: writesBefore > 0 ? 'high' : 'medium',
    confidence: 'high',
    message: `${fnName}() ignores the result of ${method}(); if the recipient needs more gas than forwarded the payment silently fails${writesBefore > 0 ? ' after state was already updated to record it as paid' : ''}.`,
    severityRationale: writesBefore > 0
      ? 'State says the recipient was paid while the funds never moved.'
      : 'A failed payment goes unnoticed by the caller.',
    confidenceEvidence: evidence,
    remediation: 'Check the success flag (require(ok) or handle the failure explicitly) and update accounting only on success.',
    details,
  });
}
