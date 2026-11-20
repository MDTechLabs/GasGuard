/**
 * GG-XCHAIN-DUPID-001 — Analyze duplicate message execution under alternate
 * identifiers.
 *
 * Replay protection keys a consumed-message record by a *message identity*.
 * That protection only holds when the identity is a faithful, canonical
 * function of exactly what the handler executes. This rule compares how the
 * identity is built with the fields the handler actually uses:
 *
 *   caller-supplied-message-id   the replay key is a parameter chosen by the
 *                                caller and not recomputed from the message, so
 *                                the same message can be resubmitted under a
 *                                fresh id (skipped when an authenticated
 *                                transport supplies the id)
 *   raw-payload-identity         the key is `keccak256(rawPayload)` while the
 *                                handler executes the *decoded* fields;
 *                                abi.decode accepts alternate encodings (trailing
 *                                bytes, padded or re-ordered dynamic offsets), so
 *                                semantically identical messages hash differently
 *   id-includes-unexecuted-fields the preimage contains fields the execution
 *                                ignores (e.g. a salt): varying them mints new
 *                                ids for the same effect
 *   id-omits-executed-fields     executed fields are missing from the preimage, so
 *                                one id can stand for different messages
 *   non-canonical-id-encoding    `abi.encodePacked` over two or more dynamic
 *                                operands makes distinct field tuples collide
 *   id-not-domain-bound          no chain/domain/contract binding in the preimage
 *
 * Field comparison is order-insensitive: re-ordering the same fields in the
 * preimage is accepted. Supported: Solidity 0.6 – 0.8.x, one file; helpers in
 * other files and inherited state are not followed. See
 * docs/rules/bridge-trust-and-oracle-answer-validation.md.
 */

import {
  Diagnostic,
  RuleResult,
  SecurityFinding,
  SolFunction,
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
  splitTopLevel,
  statementsOf,
} from '../lib/solidity-lite';

export const RULE_ID = 'GG-XCHAIN-DUPID-001';

export interface DuplicateIdentifierOptions {
  receiverNames?: string[];
  endpointNames?: string[];
}

const EXEMPT_RE = /(chain|domain|\beid\b|origin|sender|\bsrc|source|remote|nonce|sequence|\bid\b|guid|selector|_id$|Id$)/i;
const DOMAIN_RE = /(chain|domain|\beid\b|selector|address\s*\(\s*this\s*\)|block\.chainid|origin|\bsrc)/i;
const TRANSPORT_NAMES = ['lzReceive', '_lzReceive', 'ccipReceive', '_ccipReceive', 'receiveWormholeMessages'];

interface Identity {
  /** Key expression used in the consumed-message mapping. */
  key: string;
  kind: 'param' | 'hash';
  hashFn?: 'encode' | 'encodePacked' | 'raw';
  args: string[];
  preimageText: string;
  mapping: string;
  /** Offset of the consumed-message write (original source). */
  offset: number;
}

function words(text: string): string[] {
  return text.match(/[A-Za-z_$][\w$]*/g) ?? [];
}

function hashDefinition(body: string, name: string): { fn: 'encode' | 'encodePacked' | 'raw'; args: string[]; text: string } | undefined {
  const re = new RegExp(`(?<![\\w$.])${name.replace(/[$]/g, '\\$')}\\s*=\\s*keccak256\\s*\\(`);
  const m = re.exec(body);
  if (!m) return undefined;
  const open = m.index + m[0].length - 1;
  const close = findMatching(body, open, '(', ')');
  if (close === -1) return undefined;
  const inner = body.slice(open + 1, close).trim();
  const call = /^abi\s*\.\s*(encodePacked|encode)\s*\(/.exec(inner);
  if (call) {
    const o = inner.indexOf('(', call[0].length - 1);
    const c = findMatching(inner, o, '(', ')');
    const argText = inner.slice(o + 1, c === -1 ? inner.length : c);
    return { fn: call[1] as 'encode' | 'encodePacked', args: splitTopLevel(argText).map((a) => a.trim()).filter(Boolean), text: argText };
  }
  return { fn: 'raw', args: [inner], text: inner };
}

function consumedWrites(fn: SolFunction, boolMappings: string[]): { mapping: string; key: string; offset: number }[] {
  const out: { mapping: string; key: string; offset: number }[] = [];
  for (const name of boolMappings) {
    const re = new RegExp(`(?<![\\w$.])${name.replace(/[$]/g, '\\$')}((?:\\s*\\[[^\\]]*\\])+)\\s*=\\s*(?:true|1)\\b`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(fn.body)) !== null) {
      const keys = [...m[1].matchAll(/\[([^\]]*)\]/g)].map((k) => k[1].trim());
      out.push({ mapping: name, key: keys[keys.length - 1], offset: fn.bodyOffset + m.index });
    }
  }
  return out;
}

function decodedVars(fn: SolFunction, source: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const st of statementsOf(fn, source)) {
    const d = /\babi\s*\.\s*decode\s*\(\s*([A-Za-z_$][\w$]*)/.exec(st.text);
    if (!d) continue;
    const eq = st.text.search(/[^=!<>]=(?!=)/);
    const lhs = eq === -1 ? '' : st.text.slice(0, eq + 1).trim();
    if (lhs.startsWith('(')) {
      for (const part of splitTopLevel(lhs.slice(1, lhs.lastIndexOf(')')))) {
        const n = /([A-Za-z_$][\w$]*)\s*$/.exec(part.trim())?.[1];
        if (n && /\s/.test(part.trim())) map.set(n, d[1]);
      }
    } else if (lhs) {
      const n = /([A-Za-z_$][\w$]*)$/.exec(lhs)?.[1];
      if (n) map.set(n, d[1]);
    }
  }
  return map;
}

export function detectDuplicateMessageIdentifiers(input: unknown, options: DuplicateIdentifierOptions = {}): RuleResult {
  const prep = prepareSource(input);
  if (!prep.ok) return { ruleId: RULE_ID, analyzed: false, findings: [], diagnostics: prep.diagnostics };
  const { source, masked } = prep.prepared;
  const diagnostics: Diagnostic[] = [...prep.diagnostics];
  const contracts = extractContracts(masked, diagnostics);
  const functions = extractFunctions(masked, source, contracts, diagnostics);
  const mappings = extractMappings(masked, source, contracts);
  const stateNames = new Set(extractStateVars(masked, source, contracts).map((v) => v.name));
  const mods = modifierBodies(functions);
  const findings: SecurityFinding[] = [];

  for (const fn of functions) {
    if (!isMessageReceiver(fn, options.receiverNames)) continue;
    const boolMappings = mappings.filter((m) => m.contract === fn.contract && m.valueType === 'bool').map((m) => m.name);
    const writes = consumedWrites(fn, boolMappings);
    if (writes.length === 0) continue;
    const effectsAll = findEffects(fn, stateNames, source);
    const consumedNames = new Set(writes.map((w) => w.mapping));
    const effects = effectsAll.filter((e) => ![...consumedNames].some((n) => new RegExp(`(?<![\\w$.])${n}\\b`).test(e.statement.text)));
    if (effects.length === 0) continue;
    const auth = endpointAuthentication(fn, mods, options.endpointNames);
    const decoded = decodedVars(fn, source);
    const paramNames = new Set(fn.params.map((p) => p.name).filter(Boolean));
    const candidates = new Set([...paramNames, ...decoded.keys()]);
    const executed = new Set(effects.flatMap((e) => words(e.statement.text)).filter((w) => candidates.has(w)));
    const base = { ruleId: RULE_ID, contract: fn.contract, function: fn.name };

    for (const w of writes) {
      const idMatch = /^[A-Za-z_$][\w$]*$/.test(w.key) ? w.key : undefined;
      if (!idMatch) continue;
      const def = hashDefinition(fn.body, idMatch);
      const identity: Identity | undefined = def
        ? { key: idMatch, kind: 'hash', hashFn: def.fn, args: def.args, preimageText: def.text, mapping: w.mapping, offset: w.offset }
        : paramNames.has(idMatch)
          ? { key: idMatch, kind: 'param', args: [], preimageText: '', mapping: w.mapping, offset: w.offset }
          : undefined;
      if (!identity) continue;

      if (identity.kind === 'param') {
        const recomputed = new RegExp(`${idMatch}\\s*==\\s*keccak256|keccak256\\s*\\([^;]*\\)\\s*==\\s*${idMatch}`).test(fn.body);
        const transportId = auth.authenticated && (TRANSPORT_NAMES.includes(fn.name) || isReceiverName(fn.name, options.receiverNames));
        if (recomputed || transportId) continue;
        findings.push(
          makeFinding(source, identity.offset, {
            ...base,
            kind: 'caller-supplied-message-id',
            severity: 'high',
            confidence: 'high',
            message: `${fn.name}() keys ${identity.mapping}[${idMatch}] by a caller-supplied identifier that is not recomputed from the executed fields (${[...executed].join(', ') || 'none resolved'}); the same message can be resubmitted under a new id.`,
            severityRationale: 'Replay protection that trusts a caller-chosen identifier is bypassed by choosing a different identifier.',
            confidenceEvidence: [`${idMatch} is a parameter`, 'no keccak256 recomputation compared with it', auth.authenticated ? 'endpoint authenticated' : 'caller is not authenticated as the endpoint'],
            remediation: `Derive ${idMatch} inside the handler as keccak256(abi.encode(sourceDomain, remoteSender, <executed fields>)), or take it only from an authenticated transport.`,
            details: { identity: idMatch, executedFields: [...executed] },
          }),
        );
        continue;
      }

      const preimageWords = new Set(words(identity.preimageText));
      const base2 = { identity: idMatch, hashFunction: identity.hashFn, preimage: identity.args, executedFields: [...executed] };

      if (identity.hashFn === 'raw') {
        const rawParam = [...paramNames].find((p) => preimageWords.has(p));
        const decodedFromIt = rawParam ? [...decoded.entries()].filter(([, src]) => src === rawParam).map(([n]) => n) : [];
        if (rawParam && decodedFromIt.some((n) => executed.has(n))) {
          findings.push(
            makeFinding(source, identity.offset, {
              ...base,
              kind: 'raw-payload-identity',
              severity: 'high',
              confidence: 'high',
              message: `${fn.name}() keys ${identity.mapping}[${idMatch}] by keccak256(${rawParam}) but executes the decoded fields (${decodedFromIt.filter((n) => executed.has(n)).join(', ')}); padded, trailing-byte or alternate-offset encodings of the same fields hash to different ids and execute again.`,
              severityRationale: 'The replay key depends on the byte encoding while the effect depends on the decoded values; one logical message has many valid encodings.',
              confidenceEvidence: [`${idMatch} = keccak256(${rawParam})`, `abi.decode(${rawParam}, ...) feeds effects`, 'abi.decode tolerates trailing bytes and non-canonical dynamic offsets'],
              remediation: `Key the record by keccak256(abi.encode(<decoded fields>)) computed after decoding, and optionally require abi.encode(<decoded fields>) == ${rawParam} to enforce canonical encoding.`,
              details: { ...base2, rawPayload: rawParam, decodedFields: decodedFromIt },
            }),
          );
        }
        continue;
      }

      const covered = new Set([...preimageWords].filter((w2) => candidates.has(w2)));
      const missing = [...executed].filter((e) => !covered.has(e) && !EXEMPT_RE.test(e));
      const extra = [...covered].filter((c) => !executed.has(c) && !EXEMPT_RE.test(c));
      const mismatch = (a: string[]) => a.join(', ');

      if (identity.hashFn === 'encodePacked') {
        const types = new Map(fn.params.map((p) => [p.name, p.type]));
        const dyn = identity.args.filter((a) => /^[A-Za-z_$][\w$]*$/.test(a) && /^(string|bytes)$|\[\]$/.test(types.get(a) ?? ''));
        if (dyn.length >= 2) {
          findings.push(
            makeFinding(source, identity.offset, {
              ...base,
              kind: 'non-canonical-id-encoding',
              severity: 'medium',
              confidence: 'high',
              message: `${fn.name}() builds the message id with abi.encodePacked over dynamic operands (${dyn.join(', ')}); different field tuples encode to the same bytes, so unrelated messages collide on one id.`,
              severityRationale: 'Ambiguous packing lets an attacker pre-consume or alias identifiers, causing message censorship or alternate-identifier replay.',
              confidenceEvidence: [`dynamic operands: ${dyn.join(', ')}`],
              remediation: 'Use abi.encode (length-prefixed, padded) for the identity preimage.',
              details: { ...base2, dynamicOperands: dyn },
            }),
          );
        }
      }
      if (extra.length > 0) {
        findings.push(
          makeFinding(source, identity.offset, {
            ...base,
            kind: 'id-includes-unexecuted-fields',
            severity: 'high',
            confidence: 'medium',
            message: `${fn.name}() includes ${mismatch(extra)} in the replay key preimage but never uses it when executing; changing it produces a new id for the same effect.`,
            severityRationale: 'Any caller-controlled field that influences the id but not the execution is a free replay knob.',
            confidenceEvidence: [`preimage: ${identity.preimageText.replace(/\s+/g, ' ').trim()}`, `executed fields: ${[...executed].join(', ')}`, `unexecuted: ${mismatch(extra)}`],
            remediation: 'Build the id only from the source domain, remote sender, nonce and the fields the handler executes; drop caller-chosen extras such as salts.',
            details: { ...base2, unexecutedFields: extra },
          }),
        );
      }
      if (missing.length > 0) {
        findings.push(
          makeFinding(source, identity.offset, {
            ...base,
            kind: 'id-omits-executed-fields',
            severity: 'medium',
            confidence: 'medium',
            message: `${fn.name}() executes ${mismatch(missing)} but the replay key preimage does not include ${missing.length > 1 ? 'them' : 'it'}; one id can stand for different messages, so a different message can be censored or substituted.`,
            severityRationale: 'The replay key is coarser than the executed message, so the first message with an id wins regardless of its content.',
            confidenceEvidence: [`preimage: ${identity.preimageText.replace(/\s+/g, ' ').trim()}`, `executed fields: ${[...executed].join(', ')}`, `missing: ${mismatch(missing)}`],
            remediation: 'Include every executed field (or a hash of the decoded message) in the identity preimage.',
            details: { ...base2, missingFields: missing },
          }),
        );
      }
      if (!DOMAIN_RE.test(identity.preimageText)) {
        findings.push(
          makeFinding(source, identity.offset, {
            ...base,
            kind: 'id-not-domain-bound',
            severity: 'medium',
            confidence: 'medium',
            message: `${fn.name}() derives the message id without a chain/domain or contract binding; the same id is valid on every deployment and from every source domain.`,
            severityRationale: 'Without domain binding an identifier observed on one chain or deployment can be replayed on another.',
            confidenceEvidence: [`preimage: ${identity.preimageText.replace(/\s+/g, ' ').trim()}`, 'no chain/domain/eid/address(this) token'],
            remediation: 'Add the source domain and address(this) (or block.chainid) to the preimage.',
            details: base2,
          }),
        );
      }
    }
  }
  findings.sort((a, b) => a.line - b.line);
  return { ruleId: RULE_ID, analyzed: true, findings, diagnostics };
}
