/**
 * GG-XCHAIN-METADATA-001 — Identify unsafe trust in relayer-supplied source
 * metadata.
 *
 * Source chain, remote sender and proof metadata only mean something when they
 * come from an authenticated transport. If a public/external receiver takes
 * these values from calldata (as parameters, or decoded out of a caller-supplied
 * payload) and then uses them to authorize the message or to mint / credit
 * value, anyone can forge them by calling the function directly.
 *
 * The rule tracks provenance from calldata to authorization decisions:
 *   parameter  →  (alias assignments)  →  access check / mint / credit
 *
 * and recognizes *authenticated endpoint-provided metadata*: when the receiver
 * authenticates the caller as the messaging endpoint (inline check, known
 * `onlyEndpoint`-style modifier or a modifier body that compares msg.sender with
 * an endpoint-like address), its metadata parameters are treated as transport
 * context and are listed under `authenticatedReceivers` instead of reported.
 * An endpoint name match is a heuristic; it does not prove the stored address is
 * correct.
 *
 * Proof metadata (`proof`, `merkleProof`, `signature`) that is accepted but never
 * passed to a verification call is reported as `proof-not-verified`.
 *
 * Supported: Solidity 0.6 – 0.8.x, one file, intra-function. See
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
  extractStateVars,
  findEffects,
  isMessageReceiver,
  makeFinding,
  modifierBodies,
  prepareSource,
  splitTopLevel,
  statementsOf,
} from '../lib/solidity-lite';

export const RULE_ID = 'GG-XCHAIN-METADATA-001';

export interface RelayerMetadataOptions {
  receiverNames?: string[];
  endpointNames?: string[];
  /** Extra regular-expression sources naming source-metadata parameters. */
  metadataNames?: string[];
}

export interface RelayerMetadataResult extends RuleResult {
  /** Receivers whose metadata is treated as authenticated endpoint context. */
  authenticatedReceivers: { function: string; line: number; evidence: string[] }[];
}

const DOMAIN_PARAM_RE = /^(_?src\w*|_?source\w*|_?origin\w*|_?chain\w*|_?domain\w*|_?eid)$/i;
const SENDER_PARAM_RE = /^(_?sender|_?remote\w*|_?from\w*|_?peer\w*|_?srcAddress|_?sourceAddress)$/i;
const PROOF_PARAM_RE = /(proof|signature|sig)$/i;
const ACCESS_TRUST_RE = /(trusted|peer|remote|allowedSender|allowedRemote|whitelist|allowlist|authorized|sourceAddress|counterpart|otherBridge|supportedChain|isSupported|knownSender)/i;
const VERIFY_CALL_RE = /\b(verify\w*|processProof\w*|ecrecover|recover|isValidSignature|checkSignature|validateProof|_?verifyProof\w*)\s*\(/;
const MINT_LIKE_RE = /(mint|credit|release|unlock|withdraw|balance|shares|supply|claimable|reward)/i;

interface Taint {
  name: string;
  via: string;
  line: number;
}

function metadataParams(fn: SolFunction, extra: RegExp[]): string[] {
  return fn.params
    .map((p) => p.name)
    .filter((n) => n && (DOMAIN_PARAM_RE.test(n) || SENDER_PARAM_RE.test(n) || extra.some((r) => r.test(n))));
}

function decodedMetadata(fn: SolFunction, source: string, isMeta: (n: string) => boolean): Taint[] {
  const out: Taint[] = [];
  for (const st of statementsOf(fn, source)) {
    if (!/\babi\s*\.\s*decode\s*\(/.test(st.text)) continue;
    const eq = st.text.search(/[^=!<>]=(?!=)/);
    const lhs = eq === -1 ? '' : st.text.slice(0, eq + 1).trim();
    if (!lhs.startsWith('(')) continue;
    for (const part of splitTopLevel(lhs.slice(1, lhs.lastIndexOf(')')))) {
      const n = /([A-Za-z_$][\w$]*)\s*$/.exec(part.trim())?.[1];
      if (n && /\s/.test(part.trim()) && isMeta(n)) out.push({ name: n, via: 'decoded from caller-supplied payload', line: st.line });
    }
  }
  return out;
}

export function detectRelayerSuppliedMetadata(input: unknown, options: RelayerMetadataOptions = {}): RelayerMetadataResult {
  const prep = prepareSource(input);
  if (!prep.ok) return { ruleId: RULE_ID, analyzed: false, findings: [], diagnostics: prep.diagnostics, authenticatedReceivers: [] };
  const { source, masked } = prep.prepared;
  const diagnostics: Diagnostic[] = [...prep.diagnostics];
  const contracts = extractContracts(masked, diagnostics);
  const functions = extractFunctions(masked, source, contracts, diagnostics);
  const stateNames = new Set(extractStateVars(masked, source, contracts).map((v) => v.name));
  const mods = modifierBodies(functions);
  const extra = (options.metadataNames ?? []).map((s) => new RegExp(`^(?:${s})$`));
  const isMeta = (n: string) => DOMAIN_PARAM_RE.test(n) || SENDER_PARAM_RE.test(n) || extra.some((r) => r.test(n));
  const findings: SecurityFinding[] = [];
  const authenticatedReceivers: RelayerMetadataResult['authenticatedReceivers'] = [];

  for (const fn of functions) {
    if (fn.kind !== 'function' || !fn.hasBody) continue;
    if (fn.visibility !== 'public' && fn.visibility !== 'external') continue;
    const effects = findEffects(fn, stateNames, source);
    if (effects.length === 0) continue;
    const base = { ruleId: RULE_ID, contract: fn.contract, function: fn.name };
    const auth = endpointAuthentication(fn, mods, options.endpointNames);

    // --- proof metadata -------------------------------------------------
    const proofs = fn.params.map((p) => p.name).filter((n) => n && PROOF_PARAM_RE.test(n));
    const unverified = proofs.filter((p) => !new RegExp(`${VERIFY_CALL_RE.source}[^;]*(?<![\\w$.])${p.replace(/[$]/g, '\\$')}(?![\\w$])|(?<![\\w$.])${p.replace(/[$]/g, '\\$')}(?![\\w$])[^;]*${VERIFY_CALL_RE.source}`).test(fn.body));
    if (unverified.length > 0 && !auth.authenticated && effects.some((e) => MINT_LIKE_RE.test(e.statement.text))) {
      findings.push(
        makeFinding(source, fn.offset, {
          ...base,
          kind: 'proof-not-verified',
          severity: 'high',
          confidence: 'medium',
          message: `${fn.name}() accepts proof metadata (${unverified.join(', ')}) from the caller but never passes it to a verification call before crediting value.`,
          severityRationale: 'A proof or signature that is accepted and ignored authenticates nothing; the caller decides the outcome.',
          confidenceEvidence: [`parameter(s) ${unverified.join(', ')}`, 'no verify/ecrecover/processProof call involves them', `effects: ${effects.map((e) => e.statement.text.slice(0, 40)).join(' | ')}`],
          remediation: 'Verify the proof or signature against a trusted root or signer before using any associated data.',
          details: { proofParameters: unverified },
        }),
      );
    }

    // --- source-chain / sender metadata ----------------------------------
    const params = metadataParams(fn, extra);
    const decoded = decodedMetadata(fn, source, isMeta);
    const bridgeLike = params.some((n) => DOMAIN_PARAM_RE.test(n) || extra.some((r) => r.test(n))) || isMessageReceiver(fn, options.receiverNames) || decoded.length > 0;
    if (!bridgeLike || (params.length === 0 && decoded.length === 0)) continue;

    if (auth.authenticated) {
      authenticatedReceivers.push({ function: fn.name, line: fn.line, evidence: auth.evidence });
      continue;
    }

    const taints = new Map<string, Taint>();
    for (const n of params) taints.set(n, { name: n, via: 'calldata parameter', line: fn.line });
    for (const d of decoded) taints.set(d.name, d);
    // Alias propagation: `T x = expr` / `x = expr` where expr mentions a tainted name.
    for (let round = 0; round < 3; round++) {
      for (const st of statementsOf(fn, source)) {
        const m = /^(?:[A-Za-z_$][\w$.]*(?:\[\s*\d*\s*\])*\s+(?:memory\s+|calldata\s+|storage\s+)?)?([A-Za-z_$][\w$]*)\s*=(?!=)\s*(.+)$/.exec(st.text);
        if (!m || taints.has(m[1])) continue;
        const src = [...taints.keys()].find((t) => new RegExp(`(?<![\\w$.])${t.replace(/[$]/g, '\\$')}(?![\\w$])`).test(m[2]));
        if (src) taints.set(m[1], { name: m[1], via: `alias of ${src}`, line: st.line });
      }
    }
    const taintNames = [...taints.keys()];
    const mentionsTaint = (text: string) => taintNames.filter((t) => new RegExp(`(?<![\\w$.])${t.replace(/[$]/g, '\\$')}(?![\\w$])`).test(text));

    const access = statementsOf(fn, source).filter(
      (st) => /\b(require|assert|if)\b/.test(st.text) && mentionsTaint(st.text).length > 0 && ACCESS_TRUST_RE.test(st.text) && /([!=]=|\[)/.test(st.text),
    );
    // Once forged metadata passes an access decision, every mint/credit-style
    // effect is reachable; without one, only effects that use the metadata count.
    const mintLike = effects.filter((e) => MINT_LIKE_RE.test(e.statement.text));
    const value = access.length > 0 ? mintLike : mintLike.filter((e) => mentionsTaint(e.statement.text).length > 0);
    if (access.length === 0 && value.length === 0) continue;

    const used = [...new Set([...access, ...value.map((v) => v.statement)].flatMap((s) => mentionsTaint(s.text)))];
    if (used.length === 0) continue;
    const provenance = used.map((n) => {
      const t = taints.get(n)!;
      return { name: n, via: t.via, line: t.line };
    });
    findings.push(
      makeFinding(source, access[0]?.offset ?? value[0].statement.offset, {
        ...base,
        kind: 'spoofable-source-metadata',
        severity: access.length > 0 && value.length > 0 ? 'critical' : 'high',
        confidence: 'high',
        message: `${fn.name}() trusts caller-supplied source metadata (${used.join(', ')}) for ${access.length ? 'an authorization decision' : 'a value operation'}${access.length && value.length ? ' and a value operation' : ''}, and does not authenticate the messaging endpoint; any caller can forge it.`,
        severityRationale:
          access.length > 0 && value.length > 0
            ? 'Forgeable metadata both passes the trust check and drives minting/crediting, so any account can mint or release value.'
            : 'Forgeable metadata drives an authorization decision or a value operation.',
        confidenceEvidence: [
          ...provenance.map((p) => `${p.name}: ${p.via} (line ${p.line})`),
          'no endpoint caller check (inline, modifier or modifier body)',
          ...(access.length ? [`access decision: ${access[0].text.slice(0, 70)}`] : []),
          ...(value.length ? [`value operation: ${value[0].statement.text.slice(0, 70)}`] : []),
        ],
        remediation:
          'Authenticate the caller as the messaging endpoint (msg.sender == endpoint / onlyEndpoint) and use the origin metadata the endpoint supplies; never trust chain, sender or proof values taken from calldata.',
        details: { provenance, accessDecisions: access.map((a) => ({ line: a.line, statement: a.text.slice(0, 80) })), valueOperations: value.map((v) => ({ line: v.statement.line, statement: v.statement.text.slice(0, 80) })) },
      }),
    );
  }
  findings.sort((a, b) => a.line - b.line);
  return { ruleId: RULE_ID, analyzed: true, findings, diagnostics, authenticatedReceivers };
}
