/**
 * GG-ORACLE-REPLACE-001 — Detect unrestricted oracle and adapter replacement.
 *
 * Replacing a price feed or adapter changes every price the contract trusts, so
 * the replacement path deserves the strongest controls in the system. For each
 * state variable that holds an oracle / feed / adapter (a plain variable or a
 * mapping such as `feeds[token]`) the rule finds the functions that assign it
 * (or a `pending…` staging variable) and evaluates:
 *
 *   authorization  who may call: restrictive modifiers (resolved against modifier
 *                  bodies in the same file), inline `msg.sender` / role checks,
 *                  `onlyRole(R)` roles and where those roles are granted
 *   delay          a propose → apply (timelock) flow or a timestamp gate
 *   validation     the new address is probed (`decimals()`, `latestRoundData()`,
 *                  `description()`, interface calls, `supportsInterface`); a
 *                  zero-address check alone is not validation
 *   emergency      a documented emergency replacement (`emergency…` function or
 *                  guardian-style modifier) waives the delay requirement
 *
 * and reports the privileged path and the downstream financial functions that
 * depend on the replaced value.
 *
 * Supported: Solidity 0.6 – 0.8.x, one file. Modifiers and roles defined in
 * inherited bases are recognized by name only (`onlyOwner`, `onlyRole`,
 * `Ownable`, `AccessControl`, ...); who holds a role at runtime is not visible.
 * See docs/rules/oracle-configuration-and-gas-forwarding-security.md.
 */

import {
  Diagnostic,
  RuleResult,
  SecurityFinding,
  Severity,
  SolContract,
  SolFunction,
  extractContracts,
  extractFunctions,
  extractStateVars,
  makeFinding,
  modifierBodies,
  msgSenderComparands,
  prepareSource,
} from '../lib/solidity-lite';

export const RULE_ID = 'GG-ORACLE-REPLACE-001';

export interface OracleReplacementOptions {
  /** Extra regular-expression sources naming oracle/adapter variables. */
  oracleNames?: string[];
  /** Extra regular-expression sources naming documented emergency replacement paths. */
  emergencyPolicies?: string[];
  /** Extra modifier names to treat as restrictive. */
  trustedModifiers?: string[];
}

export interface OracleSetterSummary {
  variable: string;
  function: string;
  contract?: string;
  access: 'unrestricted' | 'restricted';
  privilegedPath: string[];
  roles: string[];
  delay: boolean;
  validated: boolean;
  emergency: boolean;
  dependents: string[];
}

export interface OracleReplacementResult extends RuleResult {
  setters: OracleSetterSummary[];
  roleGrants: { role: string; in: string }[];
}

const ORACLE_VAR_RE = /(oracle|priceFeed|aggregator|adapter|\bfeeds?\b|feed$|priceSource|priceProvider|twap)/i;
const PENDING_RE = /^(pending|proposed|queued|next|staged|new)/i;
const ACCESS_MOD_NAME_RE = /^(only[A-Z]\w*|auth|requiresAuth|restricted|isOwner|authorized|governance\w*|whenAuthorized|ownerOnly|adminOnly)$/;
const NOT_ACCESS = new Set(['onlyInitializing']);
const ACCESS_BASES = ['Ownable', 'Ownable2Step', 'AccessControl', 'AccessControlEnumerable', 'AccessControlDefaultAdminRules', 'Auth', 'Owned', 'Governable'];
const FIN_RE = /(borrow|liquidat|mint|withdraw|swap|redeem|collateral|\bprice\b|\bvalue\b|transfer|[*\/])/i;

function esc(n: string): string {
  return n.replace(/[$]/g, '\\$');
}

function assigns(body: string, name: string): boolean {
  return new RegExp(`(?<![\\w$.])${esc(name)}\\s*(\\[[^\\]]*\\]\\s*)*=(?!=)`).test(body);
}

interface Access {
  restricted: boolean;
  path: string[];
  roles: string[];
  unresolved: string[];
}

function accessOf(fn: SolFunction, mods: Map<string, string>, contract: SolContract | undefined, trusted: string[]): Access {
  const path: string[] = [];
  const roles: string[] = [];
  const unresolved: string[] = [];
  const inheritsAccess = !!contract?.bases.some((b) => ACCESS_BASES.includes(b));
  for (const m of fn.modifiers) {
    if (NOT_ACCESS.has(m)) continue;
    if (mods.has(m)) {
      const body = mods.get(m)!;
      if (/msg\.sender\s*[!=]=|[!=]=\s*msg\.sender|_checkRole|_checkOwner|hasRole\s*\(|\bowner\s*\(\s*\)|_msgSender\s*\(/.test(body)) {
        path.push(`modifier ${m}`);
        const role = /_checkRole\s*\(\s*([A-Za-z_$][\w$]*)/.exec(body)?.[1];
        if (role) roles.push(role);
      }
      continue;
    }
    if (ACCESS_MOD_NAME_RE.test(m) || trusted.includes(m)) {
      path.push(m);
      if (!inheritsAccess && !trusted.includes(m)) unresolved.push(m);
    }
  }
  for (const m of fn.header.matchAll(/\bonlyRole\s*\(\s*([A-Za-z_$][\w$.]*)/g)) roles.push(m[1]);
  const params = new Set(fn.params.map((p) => p.name));
  for (const c of msgSenderComparands(fn.body)) {
    if (!params.has(c) && c !== 'tx.origin') path.push(`msg.sender == ${c}`);
  }
  const inline = /\b(_checkOwner|_checkRole|_onlyOwner|_requireOwner|_requireAuth|requireAuth)\s*\(/.exec(fn.body)?.[1];
  if (inline) path.push(inline);
  if (/\b(require|if)\s*\([^;]*\bhasRole\s*\(/.test(fn.body)) path.push('hasRole check');
  return { restricted: path.length > 0, path, roles: [...new Set(roles)], unresolved };
}

export function detectUnrestrictedOracleReplacement(input: unknown, options: OracleReplacementOptions = {}): OracleReplacementResult {
  const prep = prepareSource(input);
  if (!prep.ok) return { ruleId: RULE_ID, analyzed: false, findings: [], diagnostics: prep.diagnostics, setters: [], roleGrants: [] };
  const { source, masked } = prep.prepared;
  const diagnostics: Diagnostic[] = [...prep.diagnostics];
  const contracts = extractContracts(masked, diagnostics);
  const functions = extractFunctions(masked, source, contracts, diagnostics);
  const stateVars = extractStateVars(masked, source, contracts);
  const mods = modifierBodies(functions);
  const extraOracle = (options.oracleNames ?? []).map((s) => new RegExp(s, 'i'));
  const emergencyRes = [/emergency|guardian|failsafe|circuitBreaker/i, ...(options.emergencyPolicies ?? []).map((s) => new RegExp(s, 'i'))];
  const isOracleName = (n: string) => ORACLE_VAR_RE.test(n) || extraOracle.some((r) => r.test(n));
  const findings: SecurityFinding[] = [];
  const setters: OracleSetterSummary[] = [];

  const roleGrants: { role: string; in: string }[] = [];
  for (const f of functions) {
    if (!f.hasBody || (f.kind !== 'constructor' && !/^(initialize|init|__\w*_init)/.test(f.name))) continue;
    for (const m of f.body.matchAll(/\b(?:_grantRole|_setupRole)\s*\(\s*([A-Za-z_$][\w$]*)/g)) roleGrants.push({ role: m[1], in: f.kind === 'constructor' ? 'constructor' : f.name });
  }

  const oracleVars = stateVars.filter((v) => !v.constant && !v.immutable && !/^u?int/.test(v.type) && isOracleName(v.name) && !PENDING_RE.test(v.name));
  const pendingVars = stateVars.filter((v) => PENDING_RE.test(v.name) && isOracleName(v.name.replace(PENDING_RE, '')));

  for (const v of oracleVars) {
    const contract = contracts.find((c) => c.name === v.contract);
    const sameContract = functions.filter((f) => f.contract === v.contract && f.kind === 'function' && f.hasBody);
    const assigners = sameContract.filter((f) => assigns(f.body, v.name));
    if (assigners.length === 0) continue;
    const pend = pendingVars.filter((p) => p.contract === v.contract);
    const proposers = sameContract.filter((f) => pend.some((p) => assigns(f.body, p.name)) && !assigners.includes(f));
    const applyFns = assigners.filter((f) => pend.some((p) => new RegExp(`${esc(v.name)}\\s*(\\[[^\\]]*\\]\\s*)*=(?!=)[^;]*\\b${esc(p.name)}\\b`).test(f.body)));
    const entries = proposers.length > 0 ? [...proposers, ...assigners.filter((f) => !applyFns.includes(f))] : assigners;
    const flow = [...new Set([...entries, ...applyFns])];
    const hasTimeGate = (f: SolFunction) => /\bblock\.timestamp\s*[<>]=?|[<>]=?\s*block\.timestamp|\b(eta|executeAfter|unlockTime|timelock|delay)\b/i.test(f.body) || f.modifiers.some((m) => /timelock|delay/i.test(m));
    const delay = proposers.length > 0 || flow.some(hasTimeGate);
    const validates = (f: SolFunction) =>
      /\.\s*(decimals|latestRoundData|description|asset|token|supportsInterface|getPrice\w*|latestAnswer)\s*\(/.test(f.body) ||
      /\bcode\.length\s*>\s*0|\bisContract\s*\(/.test(f.body);
    const validated = flow.some(validates);
    const dependents = [...new Set(
      sameContract
        .filter((g) => !flow.includes(g) && new RegExp(`(?<![\\w$.])${esc(v.name)}(?![\\w$])`).test(g.body) && FIN_RE.test(g.body))
        .map((g) => g.name),
    )];

    for (const entry of entries) {
      const access = accessOf(entry, mods, contract, options.trustedModifiers ?? []);
      const emergency = emergencyRes.some((r) => r.test(entry.name) || entry.modifiers.some((m) => r.test(m)));
      const timeGated = hasTimeGate(entry) || proposers.length > 0;
      const summary: OracleSetterSummary = {
        variable: v.name,
        function: entry.name,
        contract: v.contract,
        access: access.restricted ? 'restricted' : 'unrestricted',
        privilegedPath: access.path,
        roles: access.roles,
        delay: timeGated || emergency,
        validated: validates(entry) || validated,
        emergency,
        dependents,
      };
      setters.push(summary);
      const base = { ruleId: RULE_ID, contract: entry.contract, function: entry.name };
      const exposed = entry.visibility === 'public' || entry.visibility === 'external';
      if (!exposed) continue;
      const dependentText = dependents.length ? `; ${dependents.join(', ')}() use ${v.name} for financial logic` : '; no dependent financial function was found in this file';
      const evidence = [
        `assigns ${v.name}${proposers.includes(entry) ? ' via a pending value' : ''}`,
        access.restricted ? `access: ${access.path.join(', ')}` : 'no modifier, role or msg.sender check',
        dependents.length ? `dependent functions: ${dependents.join(', ')}` : 'no dependent financial functions found',
      ];
      const lower = (s: Severity): Severity => (dependents.length === 0 ? (s === 'critical' ? 'high' : s === 'high' ? 'medium' : 'low') : s);

      if (!access.restricted) {
        findings.push(
          makeFinding(source, entry.offset, {
            ...base,
            kind: 'unrestricted-oracle-replacement',
            severity: lower('critical'),
            confidence: 'high',
            message: `${entry.name}() lets any caller replace ${v.name}${dependentText}.`,
            severityRationale: 'Anyone who controls the price source controls every price-dependent decision: collateral valuation, liquidations and mints.',
            confidenceEvidence: evidence,
            remediation: 'Restrict the setter to a governance/admin role (onlyOwner / onlyRole), route it through a timelock, and validate the new source.',
            details: { variable: v.name, privilegedPath: ['any caller'], dependents },
          }),
        );
        continue;
      }
      if (applyFns.includes(entry)) continue;
      const waived = emergency;
      const noDelay = !summary.delay && !waived;
      const noValidation = !summary.validated;
      let kind: string | undefined;
      let severity: Severity = 'low';
      let why = '';
      if (noDelay && noValidation) {
        kind = 'immediate-privileged-replacement';
        severity = lower('medium');
        why = 'takes effect immediately with no timelock and no interface/asset validation of the new source';
      } else if (noDelay) {
        kind = 'privileged-replacement-no-delay';
        why = 'takes effect immediately with no timelock (the new source is validated)';
      } else if (noValidation) {
        kind = 'replacement-without-validation';
        why = waived ? 'is a documented emergency path but does not validate the interface/asset of the new source' : 'is delayed but does not validate the interface/asset of the new source';
      }
      if (!kind) continue;
      findings.push(
        makeFinding(source, entry.offset, {
          ...base,
          kind,
          severity,
          confidence: access.unresolved.length > 0 ? 'medium' : 'high',
          message: `${entry.name}() is restricted (${access.path.join(', ')}) but replacement of ${v.name} ${why}${dependentText}.`,
          severityRationale: 'A single privileged key can silently swap the price source for all dependent logic; delay and validation limit the blast radius of key compromise and misconfiguration.',
          confidenceEvidence: [...evidence, ...(access.unresolved.length ? [`modifier(s) ${access.unresolved.join(', ')} not defined in this file and no known access-control base inherited`] : []), ...(waived ? ['emergency replacement policy detected: delay requirement waived'] : [])],
          remediation: 'Stage replacements behind a timelock (propose, wait, apply), probe the new source (decimals(), latestRoundData(), asset identity) before accepting it, and keep any emergency path narrow and documented.',
          details: { variable: v.name, privilegedPath: access.path, roles: access.roles, roleGrants: roleGrants.filter((g) => access.roles.includes(g.role)), emergencyPolicy: waived, dependents },
        }),
      );
    }
  }
  findings.sort((a, b) => a.line - b.line);
  return { ruleId: RULE_ID, analyzed: true, findings, diagnostics, setters, roleGrants };
}
