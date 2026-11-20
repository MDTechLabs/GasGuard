/**
 * GG-XCHAIN-FINALITY-001 — Detect missing finality assumptions in cross-chain
 * execution.
 *
 * A source-chain event is only safe to act on once it cannot be reorganized.
 * This rule looks at handlers that consume source-chain events or proofs and
 * asks who owns that policy:
 *
 *   application-managed  the handler verifies a proof/attestation itself, so the
 *                        contract must also enforce a confirmation depth or
 *                        finality condition → `missing-finality-policy` if absent
 *   transport-managed    a known framework receiver behind an authenticated
 *                        endpoint; finality is the transport's configuration
 *                        (confirmations, DVNs, guardians) →
 *                        `finality-delegated-to-transport` (low, an assumption)
 *
 * It also locates finality configuration paths (`requiredConfirmations`,
 * `confirmationsByChain`, `challengePeriod`, ...), reports setters that accept
 * any value (`finality-config-unbounded`), and flags a single scalar policy
 * shared across several source chains
 * (`single-finality-policy-for-multiple-chains`).
 *
 * IMPORTANT LIMITATION: static analysis cannot independently verify off-chain
 * finality services — relayers, DVN/oracle networks, guardian sets or light
 * clients decide what "final" means before a message ever reaches the contract.
 * Every finding therefore carries the assumptions it rests on, and the result
 * lists them in `assumptions`.
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
  extractMappings,
  extractStateVars,
  findEffects,
  isMessageReceiver,
  isReceiverName,
  makeFinding,
  modifierBodies,
  prepareSource,
  statementsOf,
} from '../lib/solidity-lite';

export const RULE_ID = 'GG-XCHAIN-FINALITY-001';

export interface FinalityOptions {
  receiverNames?: string[];
  endpointNames?: string[];
  /** Extra regular-expression sources naming finality configuration. */
  finalityNames?: string[];
  /** Receiver names whose transport owns finality (default: lzReceive, ccipReceive, ...). */
  transportReceivers?: string[];
}

export interface FinalityConfigPath {
  name: string;
  kind: 'variable' | 'mapping';
  contract: string;
  line: number;
  chainSpecific: boolean;
  setter?: string;
  setterValidated?: boolean;
}

export interface FinalityResult extends RuleResult {
  finalityConfig: FinalityConfigPath[];
  /** Standing assumptions behind every verdict. */
  assumptions: string[];
}

const ASSUMPTIONS = [
  'Static analysis cannot independently verify off-chain finality services (relayers, DVN/oracle networks, guardian sets, light clients).',
  'A confirmation depth in contract storage is only as meaningful as the chain-specific value configured for it.',
  'Transport-managed finality depends on the messaging provider\'s per-chain configuration, which is outside this source file.',
];

const FINALITY_NAME_RE =
  /(confirmations?|finality|finalized|finalised|safeBlock|blockDepth|challengePeriod|disputeWindow|CONFIRMATION|reorg)/i;
const EVENT_PARAM_RE = /(blockNumber|blockHash|blockHeight|txHash|logIndex|receipt|header|eventProof|proof|eventData|srcBlock)/i;
const VERIFY_RE = /\b(verify\w*|processProof\w*|ecrecover|recover|isValidSignature|validateProof|_?verifyProof\w*|checkSignature)\s*\(/;
const DEFAULT_TRANSPORT = ['lzReceive', '_lzReceive', 'ccipReceive', '_ccipReceive', 'receiveWormholeMessages', 'handle'];
const DOMAIN_PARAM_RE = /^(_?src\w*|_?source\w*|_?origin\w*|_?chain\w*|_?domain\w*|_?eid)$/i;

function setterFor(fns: SolFunction[], contract: string | undefined, name: string): { setter?: string; setterValidated?: boolean } {
  const esc = name.replace(/[$]/g, '\\$');
  for (const f of fns) {
    if (f.kind !== 'function' || !f.hasBody || f.contract !== contract) continue;
    if (!new RegExp(`(?<![\\w$.])${esc}\\s*(\\[[^\\]]*\\]\\s*)*=(?!=)`).test(f.body)) continue;
    const param = f.params[f.params.length - 1]?.name;
    const validated = !!param && (
      new RegExp(`\\b(require|assert)\\s*\\([^;]*\\b${param}\\b[^;]*(>=|>|!=)`).test(f.body) ||
      new RegExp(`\\bif\\s*\\([^)]*\\b${param}\\b[^)]*(==|<=|<)[^)]*\\)\\s*\\{?\\s*(revert|return)`).test(f.body)
    );
    return { setter: f.name, setterValidated: validated };
  }
  return {};
}

export function detectMissingFinalityAssumptions(input: unknown, options: FinalityOptions = {}): FinalityResult {
  const prep = prepareSource(input);
  if (!prep.ok) {
    return { ruleId: RULE_ID, analyzed: false, findings: [], diagnostics: prep.diagnostics, finalityConfig: [], assumptions: ASSUMPTIONS };
  }
  const { source, masked } = prep.prepared;
  const diagnostics: Diagnostic[] = [...prep.diagnostics];
  const contracts = extractContracts(masked, diagnostics);
  const functions = extractFunctions(masked, source, contracts, diagnostics);
  const stateVars = extractStateVars(masked, source, contracts);
  const mappings = extractMappings(masked, source, contracts);
  const stateNames = new Set(stateVars.map((v) => v.name));
  const mods = modifierBodies(functions);
  const extraRes = (options.finalityNames ?? []).map((s) => new RegExp(s, 'i'));
  const isFinalityName = (n: string) => FINALITY_NAME_RE.test(n) || extraRes.some((r) => r.test(n));
  const transport = new Set([...DEFAULT_TRANSPORT, ...(options.transportReceivers ?? [])]);
  const findings: SecurityFinding[] = [];

  // --- configuration paths --------------------------------------------------
  const finalityConfig: FinalityConfigPath[] = [];
  for (const v of stateVars) {
    if (!isFinalityName(v.name)) continue;
    if (!/^(u?int\d*|uint\d+)$/.test(v.type) && !/^mapping/.test(v.type)) continue;
    const isMap = /^mapping/.test(v.type);
    finalityConfig.push({ name: v.name, kind: isMap ? 'mapping' : 'variable', contract: v.contract, line: v.line, chainSpecific: isMap, ...setterFor(functions, v.contract, v.name) });
  }
  for (const m of mappings) {
    if (!isFinalityName(m.name) || finalityConfig.some((c) => c.name === m.name)) continue;
    finalityConfig.push({ name: m.name, kind: 'mapping', contract: m.contract ?? '', line: m.line, chainSpecific: true, ...setterFor(functions, m.contract, m.name) });
  }
  for (const c of finalityConfig) {
    if (c.setter && c.setterValidated === false) {
      const fn = functions.find((f) => f.name === c.setter && f.contract === c.contract)!;
      findings.push(
        makeFinding(source, fn.offset, {
          ruleId: RULE_ID,
          kind: 'finality-config-unbounded',
          severity: 'low',
          confidence: 'medium',
          contract: fn.contract,
          function: fn.name,
          message: `${fn.name}() sets the finality parameter ${c.name} without a lower bound; a zero or tiny value silently disables the confirmation policy.`,
          severityRationale: 'A misconfigured depth removes finality protection for every chain that reads it.',
          confidenceEvidence: [`assignment to ${c.name}`, `no require/revert bounding the new value`],
          remediation: `Require a sane minimum (e.g. require(value >= MIN_CONFIRMATIONS)) and, for chain-specific values, a per-chain minimum.`,
          details: { config: c.name, assumptions: ASSUMPTIONS },
        }),
      );
    }
  }

  // --- handlers ---------------------------------------------------------------
  for (const fn of functions) {
    if (fn.kind !== 'function' || !fn.hasBody) continue;
    if (fn.visibility !== 'public' && fn.visibility !== 'external') continue;
    const consumes = isMessageReceiver(fn, options.receiverNames) || fn.params.some((p) => EVENT_PARAM_RE.test(p.name));
    if (!consumes) continue;
    const effects = findEffects(fn, stateNames, source);
    if (effects.length === 0) continue;
    const valueMoves = effects.some((e) => e.kind === 'value-transfer' || /balance|credit|shares|supply|claimable|owed|reward|mint/i.test(e.statement.text));
    const auth = endpointAuthentication(fn, mods, options.endpointNames);
    const transportManaged = auth.authenticated && (transport.has(fn.name) || isReceiverName(fn.name, options.receiverNames));
    const proofVerified = VERIFY_RE.test(fn.body);

    const modifierText = fn.modifiers.map((m) => mods.get(m) ?? '').join('\n');
    const modifierFinal = fn.modifiers.some((m) => /final/i.test(m));
    const cfgNames = finalityConfig.map((c) => c.name);
    const tokens = [...cfgNames, 'confirmations', 'confirmationCount', 'finalized', 'isFinalized', 'finalizedBlock', 'safeBlock', 'finality'];
    const text = `${fn.body}\n${modifierText}`;
    const stmts = [...statementsOf(fn, source).map((s) => s.text), ...modifierText.split(';')];
    const checksFinality =
      modifierFinal ||
      /\b(isFinal\w*|_?requireFinal\w*)\s*\(/.test(text) ||
      stmts.some(
        (s) =>
          /\b(require|assert|if)\b/.test(s) &&
          /([<>]=?|==|!=)/.test(s) &&
          (tokens.some((t) => new RegExp(`(?<![\\w$.])${t.replace(/[$]/g, '\\$')}(?![\\w$])`).test(s)) || isFinalityName(s)),
      );
    const base = { ruleId: RULE_ID, contract: fn.contract, function: fn.name };

    if (transportManaged) {
      if (!checksFinality) {
        findings.push(
          makeFinding(source, fn.offset, {
            ...base,
            kind: 'finality-delegated-to-transport',
            severity: 'low',
            confidence: 'medium',
            message: `${fn.name}() acts on a cross-chain message without its own finality check; finality is delegated to the messaging transport behind ${auth.evidence[0] ?? 'the endpoint'}.`,
            severityRationale: 'Delegation is reasonable, but safety depends on chain-specific transport settings that this source does not show.',
            confidenceEvidence: [`known transport receiver ${fn.name}`, ...auth.evidence, 'no confirmation/finality comparison in the handler'],
            remediation: 'Document the required confirmations/DVN or guardian configuration per source chain and verify it is applied before enabling the route.',
            details: { mode: 'transport-managed', chainSpecificConfigurationDependency: true, assumptions: ASSUMPTIONS },
          }),
        );
      }
      continue;
    }

    if (!checksFinality) {
      findings.push(
        makeFinding(source, fn.offset, {
          ...base,
          kind: 'missing-finality-policy',
          severity: valueMoves ? 'high' : 'medium',
          confidence: proofVerified ? 'high' : 'medium',
          message: `${fn.name}() acts on a source-chain ${proofVerified ? 'event proven by a proof/signature' : 'event claim'} but enforces no confirmation depth or finality condition; a reorganized source block can still be executed here.`,
          severityRationale: valueMoves
            ? 'Value is released against an event that may later be reorganized away.'
            : 'State changes against an event that may later be reorganized away.',
          confidenceEvidence: [
            proofVerified ? 'handler verifies a proof/signature itself (application-managed finality)' : 'no proof verification or transport authentication found',
            `event-like parameters: ${fn.params.filter((p) => EVENT_PARAM_RE.test(p.name)).map((p) => p.name).join(', ') || 'none'}`,
            cfgNames.length ? `finality configuration exists (${cfgNames.join(', ')}) but is not consulted here` : 'no finality/confirmation configuration found in the contract',
          ],
          remediation:
            'Require a confirmation depth or a finalized-block attestation (e.g. require(confirmations >= requiredConfirmations[srcChain])) before executing, and bound the configuration.',
          details: { mode: 'application-managed', proofVerified, configuration: cfgNames, assumptions: ASSUMPTIONS },
        }),
      );
      continue;
    }

    // Finality is checked: is one scalar policy shared across several chains?
    const hasDomain = fn.params.some((p) => DOMAIN_PARAM_RE.test(p.name));
    const usesMapping = finalityConfig.some((c) => c.kind === 'mapping' && new RegExp(`(?<![\\w$.])${c.name}\\s*\\[`).test(text));
    const usesScalar = finalityConfig.some((c) => c.kind === 'variable' && new RegExp(`(?<![\\w$.])${c.name}(?![\\w$])`).test(text));
    if (hasDomain && usesScalar && !usesMapping) {
      findings.push(
        makeFinding(source, fn.offset, {
          ...base,
          kind: 'single-finality-policy-for-multiple-chains',
          severity: 'low',
          confidence: 'medium',
          message: `${fn.name}() accepts events from different source chains but applies one scalar finality value; chains finalize at very different depths.`,
          severityRationale: 'A depth that is safe for one chain can be unsafe (or needlessly slow) for another.',
          confidenceEvidence: [`domain parameter: ${fn.params.find((p) => DOMAIN_PARAM_RE.test(p.name))!.name}`, `scalar configuration used: ${finalityConfig.filter((c) => c.kind === 'variable').map((c) => c.name).join(', ')}`],
          remediation: 'Key the confirmation depth by source chain, e.g. mapping(uint32 => uint256) confirmationsByChain.',
          details: { chainSpecificConfigurationDependency: true, assumptions: ASSUMPTIONS },
        }),
      );
    }
  }
  findings.sort((a, b) => a.line - b.line);
  return { ruleId: RULE_ID, analyzed: true, findings, diagnostics, finalityConfig, assumptions: ASSUMPTIONS };
}
