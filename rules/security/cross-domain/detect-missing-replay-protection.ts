/**
 * GG-XCHAIN-REPLAY-001 — Detect missing replay protection in cross-domain
 * message handlers.
 *
 * A cross-domain message must execute at most once, and "once" is only
 * meaningful relative to the (source domain, remote sender, message identity)
 * triple. This rule inspects message-execution entry points for
 *
 *   1. a consumed-message record that is both checked and written,
 *   2. a record whose key actually covers source domain and remote sender, and
 *   3. whether replay protection is instead guaranteed by an authenticated
 *      transport (known framework receivers behind an endpoint check) rather
 *      than by the application.
 *
 * Supported: Solidity 0.6 – 0.8.x source text, one file at a time. Handlers are
 * recognized by name (configurable) or by shape (a `bytes` payload/message
 * parameter plus value or state effects). Replay state kept in other contracts,
 * inherited bases or libraries is NOT followed; one level of same-file internal
 * helper calls is. See docs/rules/signature-and-cross-domain-message-security.md.
 */

import {
  Diagnostic,
  RuleResult,
  SecurityFinding,
  Severity,
  SolFunction,
  SolMapping,
  endpointAuthentication,
  extractContracts,
  extractFunctions,
  extractMappings,
  extractStateVars,
  findEffects,
  findMatching,
  isMessageReceiver,
  isReceiverName,
  makeFinding,
  modifierBodies,
  prepareSource,
} from '../lib/solidity-lite';

export const RULE_ID = 'GG-XCHAIN-REPLAY-001';

export interface ReplayProtectionOptions {
  /** Extra function names to treat as message receivers. */
  receiverNames?: string[];
  /** Extra identifiers to treat as messaging endpoints in caller checks. */
  endpointNames?: string[];
  /** Framework receivers (lzReceive, ccipReceive, ...) whose transport already prevents replay. */
  transportReplayFrameworks?: string[];
}

const DEFAULT_TRANSPORT_REPLAY = ['lzReceive', '_lzReceive', 'ccipReceive', '_ccipReceive', 'receiveWormholeMessages'];

const DOMAIN_RE =
  /(srcChain|srcEid|srcDomain|sourceChain|sourceDomain|sourceEid|originChain|originDomain|chainId|chainSelector|remoteChain|fromChain|\beid\b|domainId|\borigin\b|_origin)/i;
const SENDER_RE = /(\bsender\b|_sender|srcAddress|remoteAddress|remoteSender|fromAddress|\bpeer\b|\borigin\b|_origin|\bfrom\b)/i;
const IDENTITY_PARAM_RE = /(messageId|msgId|\bid\b|_id|guid|nonce|hash|digest)/i;
const CONSUMED_NAME_RE = /(processed|executed|consumed|handled|used|delivered|completed|seen|claimed|nonce|replay)/i;

interface ConsumedUse {
  mapping: string;
  keys: string[];
  checked: boolean;
  written: boolean;
}

function bracketGroups(text: string, from: number): { keys: string[]; end: number } {
  const keys: string[] = [];
  let i = from;
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] !== '[') break;
    const close = findMatching(text, i, '[', ']');
    if (close === -1) break;
    keys.push(text.slice(i + 1, close).trim());
    i = close + 1;
  }
  return { keys, end: i };
}

function escapeRe(name: string): string {
  return name.replace(/[$]/g, '\\$');
}

function consumedUses(code: string, mappings: SolMapping[]): ConsumedUse[] {
  const out: ConsumedUse[] = [];
  for (const mp of mappings) {
    const isBool = mp.valueType === 'bool';
    const isCounterLike = CONSUMED_NAME_RE.test(mp.name) && /^(u?int\d*|bytes32)$/.test(mp.valueType);
    if (!isBool && !isCounterLike) continue;
    const re = new RegExp(`(?<![\\w$.])(\\+\\+\\s*)?${escapeRe(mp.name)}(?![\\w$])`, 'g');
    const uses: ConsumedUse = { mapping: mp.name, keys: [], checked: false, written: false };
    let seen = false;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      const { keys, end } = bracketGroups(code, m.index + m[0].length);
      if (keys.length === 0) continue;
      seen = true;
      const rest = code.slice(end, end + 24);
      const before = code.slice(Math.max(0, m.index - 24), m.index);
      const isWrite =
        !!m[1] || /^\s*(\+\+|\+=)/.test(rest) || (/^\s*=(?!=)/.test(rest) && !/^\s*=\s*(false|0)\b/.test(rest));
      const isCheck =
        /!\s*$/.test(before) ||
        /[=!]=\s*$/.test(before) ||
        /^\s*[=!]=/.test(rest) ||
        (/\bif\s*\(\s*$/.test(before) && !isWrite);
      if (isWrite) uses.written = true;
      if (isCheck) uses.checked = true;
      uses.keys.push(...keys);
    }
    if (seen) out.push(uses);
  }
  return out;
}

function resolveKeyTokens(keys: string[], code: string): string {
  let text = keys.join(' ');
  for (const k of keys) {
    const ident = /^[A-Za-z_$][\w$]*$/.exec(k);
    if (!ident) continue;
    const def = new RegExp(`(?<![\\w$.])${escapeRe(k)}\\s*=\\s*keccak256\\s*\\(`).exec(code);
    if (def) {
      const open = def.index + def[0].length - 1;
      const close = findMatching(code, open, '(', ')');
      if (close !== -1) text += ' ' + code.slice(open + 1, close);
    }
  }
  return text;
}

export function detectMissingReplayProtection(input: unknown, options: ReplayProtectionOptions = {}): RuleResult {
  const prep = prepareSource(input);
  if (!prep.ok) return { ruleId: RULE_ID, analyzed: false, findings: [], diagnostics: prep.diagnostics };
  const { source, masked } = prep.prepared;
  const diagnostics: Diagnostic[] = [...prep.diagnostics];
  const contracts = extractContracts(masked, diagnostics);
  const functions = extractFunctions(masked, source, contracts, diagnostics);
  const mappings = extractMappings(masked, source, contracts);
  const stateNames = new Set(extractStateVars(masked, source, contracts).map((v) => v.name));
  const mods = modifierBodies(functions);
  const transport = new Set([...DEFAULT_TRANSPORT_REPLAY, ...(options.transportReplayFrameworks ?? [])]);
  const findings: SecurityFinding[] = [];

  for (const fn of functions) {
    if (!isMessageReceiver(fn, options.receiverNames)) continue;
    const effects = findEffects(fn, stateNames, source);
    if (effects.length === 0) continue;

    // One level of same-file internal helper calls.
    let code = fn.body;
    for (const other of functions) {
      if (other === fn || !other.hasBody || other.contract !== fn.contract || other.kind !== 'function') continue;
      if (new RegExp(`(?<![\\w$.])${escapeRe(other.name)}\\s*\\(`).test(fn.body)) code += '\n' + other.body;
    }

    const scopedMappings = mappings.filter((mp) => mp.contract === fn.contract);
    const uses = consumedUses(code, scopedMappings);
    const identityParams = fn.params.filter((p) => IDENTITY_PARAM_RE.test(p.name)).map((p) => p.name);
    const auth = endpointAuthentication(fn, mods, options.endpointNames);
    const transportGuaranteed = transport.has(fn.name) && auth.authenticated;
    const writes = uses.filter((u) => u.written);
    const base = { ruleId: RULE_ID, contract: fn.contract, function: fn.name };
    const valueMoves = effects.some(
      (e) => e.kind === 'value-transfer' || /balance|credit|shares|supply|claimable|owed|reward/i.test(e.statement.text),
    );
    const sev = (hi: Severity): Severity => (valueMoves ? hi : hi === 'high' ? 'medium' : 'low');

    if (writes.length === 0) {
      if (transportGuaranteed) {
        findings.push(
          makeFinding(source, fn.offset, {
            ...base,
            kind: 'relies-on-transport-replay-protection',
            severity: 'low',
            confidence: 'medium',
            message: `${fn.name}() keeps no consumed-message state and relies on the messaging transport to deliver each message once.`,
            severityRationale:
              'The caller is authenticated as the messaging endpoint, so replay is the transport\'s responsibility; this is an assumption, not an application-level guarantee.',
            confidenceEvidence: [`known receiver ${fn.name}`, ...auth.evidence, 'no application-level consumed-message mapping written'],
            remediation:
              'Document the transport replay guarantee, or add an application-level consumed-message check keyed by (source domain, remote sender, message id) as defense in depth.',
            details: { transportGuaranteed: true, identityParams },
          }),
        );
        continue;
      }
      findings.push(
        makeFinding(source, fn.offset, {
          ...base,
          kind: 'missing-replay-protection',
          severity: sev('high'),
          confidence: identityParams.length > 0 || isReceiverName(fn.name, options.receiverNames) ? 'high' : 'medium',
          message: `${fn.name}() executes a cross-domain message without recording it as consumed; the same message can be delivered and executed repeatedly.`,
          severityRationale: valueMoves
            ? 'The handler moves value or invokes external calls, so a replay repeats the payout.'
            : 'The handler changes contract state on every delivery with no one-time guard.',
          confidenceEvidence: [
            `handler recognized: ${fn.name}`,
            `effects: ${effects.map((e) => e.statement.text.slice(0, 40)).join(' | ')}`,
            identityParams.length ? `message identity available: ${identityParams.join(', ')}` : 'no message identity parameter found',
            'no consumed-message mapping is written',
          ],
          remediation:
            'Record each message in a mapping keyed by keccak256(abi.encode(sourceDomain, remoteSender, messageId)) and revert if it is already set, before performing effects.',
          details: { identityParams, transportGuaranteed: false },
        }),
      );
      continue;
    }

    for (const u of writes) {
      if (!u.checked) {
        findings.push(
          makeFinding(source, fn.offset, {
            ...base,
            kind: 'consumed-state-not-checked',
            severity: sev('high'),
            confidence: 'medium',
            message: `${fn.name}() writes ${u.mapping}[...] but never reverts when the entry is already set; replays still execute.`,
            severityRationale: 'A consumed-message record that is written but never checked gives no replay protection.',
            confidenceEvidence: [`write to ${u.mapping}`, `no check of ${u.mapping} found in ${fn.name}() or one level of helper calls`],
            remediation: `Add require(!${u.mapping}[key]) (or an equivalent revert) before setting ${u.mapping}[key].`,
            details: { mapping: u.mapping },
          }),
        );
        continue;
      }
      const scope = resolveKeyTokens(u.keys, code);
      const expectsDomain = fn.params.some((p) => DOMAIN_RE.test(p.name) || /Origin/.test(p.type));
      const expectsSender = fn.params.some((p) => SENDER_RE.test(p.name) || /Origin/.test(p.type));
      const hasDomain = DOMAIN_RE.test(scope);
      const hasSender = SENDER_RE.test(scope);
      const missing: string[] = [];
      if (!hasDomain) missing.push('source domain');
      if (!hasSender) missing.push('remote sender');
      if (missing.length === 0) continue;
      const verifiable = (!hasDomain && expectsDomain) || (!hasSender && expectsSender);
      if (!verifiable) {
        findings.push(
          makeFinding(source, fn.offset, {
            ...base,
            kind: 'replay-scope-unverifiable',
            severity: 'low',
            confidence: 'low',
            message: `${fn.name}() consumed-message key ${u.mapping}[${u.keys.join('][')}] does not visibly include ${missing.join(' and ')}, and the handler receives no such parameter.`,
            severityRationale: 'Without source-domain or sender inputs the key cannot be scoped; this may be safe if the contract serves one fixed remote.',
            confidenceEvidence: [`key tokens: ${scope.trim()}`, 'no domain/sender parameters on the handler'],
            remediation: 'If the contract accepts messages from more than one chain or sender, include both in the replay key.',
            details: { mapping: u.mapping, missing },
          }),
        );
        continue;
      }
      findings.push(
        makeFinding(source, fn.offset, {
          ...base,
          kind: 'replay-scope-incomplete',
          severity: sev('high'),
          confidence: 'high',
          message: `${fn.name}() tracks consumed messages in ${u.mapping}[${u.keys.join('][')}] without ${missing.join(' and ')}; an identical message id from another ${missing.join('/')} is treated as a replay (or collides).`,
          severityRationale:
            'A replay key that omits the source domain or remote sender lets messages from different origins collide, enabling cross-domain replay or message censorship.',
          confidenceEvidence: [
            `key tokens: ${scope.trim()}`,
            `handler receives ${[expectsDomain ? 'a domain parameter' : '', expectsSender ? 'a sender parameter' : ''].filter(Boolean).join(' and ')}`,
            transportGuaranteed ? 'transport also guarantees delivery once, reducing exploitability' : 'no transport-level guarantee detected',
          ],
          remediation: `Key ${u.mapping} by keccak256(abi.encode(sourceDomain, remoteSender, messageId)) or nest the mapping by domain and sender.`,
          details: { mapping: u.mapping, keys: u.keys, missing, transportGuaranteed },
        }),
      );
    }
  }
  findings.sort((a, b) => a.line - b.line);
  return { ruleId: RULE_ID, analyzed: true, findings, diagnostics };
}
