/**
 * GG-XCHAIN-SENDER-001 — Validate remote sender authentication in cross-chain
 * receivers.
 *
 * A cross-chain receiver has two distinct trust questions:
 *
 *   (1) Is the CALLER the messaging endpoint (router / bridge / mailbox)?
 *   (2) Is the REMOTE SENDER the expected application on the source chain?
 *
 * Checking only (1) lets any application on the remote side message the
 * contract; checking only (2) compares a caller-supplied value, which anyone can
 * forge by calling the receiver directly. Both are required.
 *
 * Supported: Solidity 0.6 – 0.8.x source, one file. Endpoint and trusted-remote
 * identifiers are recognized by name patterns plus the `endpointNames` /
 * `remoteNames` options; a name match never makes an address trustworthy, it
 * only shows that the caller or sender is compared with a stored value. Checks
 * performed in other contracts or inherited bases are not visible; for known
 * framework bases that perform both checks in the base, a low-severity
 * "framework authentication assumed" note is emitted instead of a verdict.
 */

import {
  Diagnostic,
  RuleResult,
  SecurityFinding,
  Severity,
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
  statementsOf,
} from '../lib/solidity-lite';

export const RULE_ID = 'GG-XCHAIN-SENDER-001';

export interface RemoteSenderOptions {
  /** Extra function names to treat as receivers. */
  receiverNames?: string[];
  /** Extra identifiers recognized as messaging endpoints. */
  endpointNames?: string[];
  /** Extra identifiers recognized as trusted-remote storage. */
  remoteNames?: string[];
  /** Base contracts that perform endpoint + remote checks in their own receiver. */
  frameworkBases?: string[];
  /** When false, framework bases are not assumed and `_lzReceive`-style hooks are analyzed directly. */
  assumeFrameworkBases?: boolean;
}

const DEFAULT_FRAMEWORK_BASES = ['OApp', 'OAppReceiver', 'OFT', 'OAppCore', 'CCIPReceiver', 'AxelarExecutable', 'AbstractMessageIdAuthorizedIsm'];

const SENDER_PARAM_RE = /(sender|srcaddress|remote|origin|from|peer|source)/i;
const TRUSTED_RE =
  /(trusted|peer|remote|allowedSender|allowedRemote|whitelist|allowlist|authorizedSender|sourceAddress|counterpart|otherBridge|otherSide|gateway|\bl1\w*|\bl2\w*|expectedSender|knownSender)/i;
const HELPER_CHECK_RE =
  /(getPeerOrRevert|requireTrusted\w*|isTrusted\w*|_?requirePeer\w*|onlyPeer|onlyTrusted\w*|checkRemote\w*|validateRemote\w*|verifySender\w*|isTrustedRemote)/;
const NATIVE_SENDER_RE = /(xDomainMessageSender|messageSender|crossChainSender)\s*\(/;

interface RemoteCheck {
  present: boolean;
  evidence: string[];
}

function remoteSenderCheck(fn: SolFunction, mods: Map<string, string>, remoteNames: string[]): RemoteCheck {
  const evidence: string[] = [];
  const senderTokens = fn.params.filter((p) => SENDER_PARAM_RE.test(p.name)).map((p) => p.name);
  const trusted = (t: string) => TRUSTED_RE.test(t) || remoteNames.some((n) => t.toLowerCase().includes(n.toLowerCase()));
  const check = (text: string, where: string) => {
    for (const piece of text.split(/;|\{|\}/)) {
      if (!/\b(require|assert|if)\b|[!=]=/.test(piece)) continue;
      const mentionsSender = senderTokens.some((t) => new RegExp(`(?<![\\w$.])${t.replace(/[$]/g, '\\$')}(?![\\w$])`).test(piece)) || NATIVE_SENDER_RE.test(piece);
      if (mentionsSender && trusted(piece) && /([!=]=|\[)/.test(piece)) evidence.push(`${where}: ${piece.trim().slice(0, 70)}`);
    }
    if (HELPER_CHECK_RE.test(text)) evidence.push(`${where}: helper check ${HELPER_CHECK_RE.exec(text)![0]}`);
  };
  check(fn.body, fn.name);
  for (const m of fn.modifiers) {
    if (HELPER_CHECK_RE.test(m)) evidence.push(`modifier ${m}`);
    else if (mods.has(m)) check(mods.get(m)!, `modifier ${m}`);
  }
  return { present: evidence.length > 0, evidence };
}

export function detectMissingRemoteSenderAuth(input: unknown, options: RemoteSenderOptions = {}): RuleResult {
  const prep = prepareSource(input);
  if (!prep.ok) return { ruleId: RULE_ID, analyzed: false, findings: [], diagnostics: prep.diagnostics };
  const { source, masked } = prep.prepared;
  const diagnostics: Diagnostic[] = [...prep.diagnostics];
  const contracts = extractContracts(masked, diagnostics);
  const functions = extractFunctions(masked, source, contracts, diagnostics);
  const stateNames = new Set(extractStateVars(masked, source, contracts).map((v) => v.name));
  const mods = modifierBodies(functions);
  const frameworks = new Set([...DEFAULT_FRAMEWORK_BASES, ...(options.frameworkBases ?? [])]);
  const assume = options.assumeFrameworkBases !== false;
  const findings: SecurityFinding[] = [];

  for (const fn of functions) {
    if (!isMessageReceiver(fn, options.receiverNames)) continue;
    const contract = contracts.find((c) => c.name === fn.contract);
    const base = { ruleId: RULE_ID, contract: fn.contract, function: fn.name };
    const internal = fn.visibility === 'internal' || fn.visibility === 'private';
    const frameworkBase = contract?.bases.find((b) => frameworks.has(b));

    if (internal) {
      if (assume && frameworkBase && fn.name.startsWith('_')) {
        findings.push(
          makeFinding(source, fn.offset, {
            ...base,
            kind: 'framework-authentication-assumed',
            severity: 'low',
            confidence: 'low',
            message: `${fn.name}() is a receiver hook of ${frameworkBase}; endpoint and remote-sender authentication are assumed to be enforced by the base contract.`,
            severityRationale: 'The base class normally authenticates both identities, but its behavior is not verified by this rule.',
            confidenceEvidence: [`inherits ${frameworkBase}`, 'hook is internal and only reachable through the base receiver'],
            remediation: `Confirm ${frameworkBase} is the audited upstream version, that the peer/trusted-remote mapping is set for every connected chain, and that the receiver is not overridden.`,
            details: { frameworkBase, assumed: true },
          }),
        );
        continue;
      }
      // Plain internal helpers are skipped unless explicitly configured, or
      // unless framework assumptions are disabled and the hook must stand alone.
      const explicit = !!options.receiverNames?.includes(fn.name);
      if (!(explicit || (!assume && frameworkBase))) continue;
    }

    const effects = findEffects(fn, stateNames, source);
    if (effects.length === 0) continue;
    const endpoint = endpointAuthentication(fn, mods, options.endpointNames);
    const remote = remoteSenderCheck(fn, mods, options.remoteNames ?? []);
    if (endpoint.authenticated && remote.present) continue;

    const valueMoves = effects.some(
      (e) => e.kind === 'value-transfer' || /balance|credit|shares|supply|claimable|owed|reward/i.test(e.statement.text),
    );
    const operations = effects.map((e) => ({ line: e.statement.line, text: e.statement.text.slice(0, 80), kind: e.kind }));
    const first = effects[0].statement;
    let kind: string;
    let severity: Severity;
    let message: string;
    let rationale: string;
    let remediation: string;
    let path: string;
    if (!endpoint.authenticated && !remote.present) {
      kind = 'unauthenticated-receiver';
      severity = valueMoves ? 'critical' : 'high';
      message = `${fn.name}() authenticates neither the messaging endpoint nor the remote sender; any account can call it directly and drive the cross-chain operation.`;
      rationale = 'Both identity checks are missing, so the receiver is a public entry point for arbitrary messages.';
      remediation =
        'Restrict the caller to the stored endpoint address and require the decoded remote sender to equal the trusted remote registered for the source chain.';
      path = `any caller → ${fn.name}() → ${first.text.slice(0, 50)}`;
    } else if (endpoint.authenticated) {
      kind = 'remote-sender-unchecked';
      severity = valueMoves ? 'high' : 'medium';
      message = `${fn.name}() authenticates the endpoint but never compares the remote sender with a trusted remote; any application on the source chain can send a message that executes here.`;
      rationale = 'The endpoint proves a message was delivered, not that the intended remote application sent it.';
      remediation = 'Store a trusted remote (peer) per source chain and revert unless the delivered sender equals it.';
      path = `any remote application → endpoint → ${fn.name}() → ${first.text.slice(0, 50)}`;
    } else {
      kind = 'endpoint-unauthenticated';
      severity = valueMoves ? 'critical' : 'high';
      message = `${fn.name}() compares a remote sender but does not authenticate the caller as the messaging endpoint; the sender value is caller-supplied and can be forged.`;
      rationale = 'A remote-sender comparison is meaningless unless the value comes from an authenticated transport.';
      remediation = 'Require msg.sender == endpoint (or an onlyEndpoint modifier) before trusting the decoded sender.';
      path = `any caller supplying a trusted sender → ${fn.name}() → ${first.text.slice(0, 50)}`;
    }
    findings.push(
      makeFinding(source, fn.offset, {
        ...base,
        kind,
        severity,
        confidence: 'high',
        message,
        severityRationale: `${rationale} ${valueMoves ? 'The operation moves value or credits balances.' : 'The operation changes contract state.'}`,
        confidenceEvidence: [
          endpoint.authenticated ? `endpoint check: ${endpoint.evidence.join('; ')}` : 'no endpoint caller check found',
          remote.present ? `remote sender check: ${remote.evidence.join('; ')}` : 'no remote sender comparison found',
          `statements considered: ${statementsOf(fn).length}`,
        ],
        remediation,
        details: { untrustedPath: path, affectedOperations: operations, endpointAuthenticated: endpoint.authenticated, remoteSenderChecked: remote.present },
      }),
    );
  }
  return { ruleId: RULE_ID, analyzed: true, findings, diagnostics };
}
