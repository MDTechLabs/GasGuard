/**
 * GG-AUTH-PAUSE-001 — Pause / unpause authority separation.
 *
 * Resolves who can pause and who can unpause (modifiers, msg.sender comparisons, roles) and builds the role
 * graph around them: role constants, `_grantRole` / `_setupRole` / `grantRole` holders (constructors and
 * initializers included) and `_setRoleAdmin` edges (default: DEFAULT_ADMIN_ROLE administers every role).
 *
 * Findings:
 *   unpause-unrestricted        anyone can unpause                                  (critical)
 *   pause-unrestricted          anyone can pause                                    (high)
 *   unpause-broader-than-policy unpause gate or its role admin is wider than the configured policy (high)
 *   unpause-role-admin-broad    the admin of the unpause role is a pause-only authority per policy (medium)
 *   pause-authority-lost        the pause role/authority has no holder and no one can grant it (high)
 *   unpause-authority-lost      same for unpause: the contract can stay paused forever (high)
 *   pause-authority-unassigned / unpause-authority-unassigned  nobody holds the role now but its admin can grant it (low)
 *   pause-unpause-not-separated policy requires separation but one authority does both (low)
 *   missing-emergency-pause     no pause function, reported only when `policy.requirePause` is true (medium)
 * Every result carries the role graph in `details.roleGraph` and as `notes`.
 *
 * "Documented policy" is supplied through the `policy` option (authority names as written in the code);
 * without a policy only unconditional problems (unrestricted, lost authority) are reported.
 *
 * Supported: Solidity 0.6 – 0.8.x source text (string or `{ path, content }[]`); nothing is executed and no project
 * configuration is trusted. Limitations: lexical and name based; runtime role grants/revocations through
 * externally supplied transactions are not visible; inherited roles from unresolved bases are not analyzed.
 * See docs/rules/solidity-authorization.md.
 */
import { Diagnostic, RuleResult, SecurityFinding, Severity, lineColumn } from '../lib/solidity-lite';
import { ModelFunction, ProjectModel, ProjectSource, buildProjectModel, functionsOf, isExternallyCallable, isStateChanging, mro, stateVarsOf } from '../lib/project-model';
import { ACCESS_CONTROL_BASE_RE, Gate, externalBases, gateOf, isGated, normalizeToken } from '../lib/authority-model';

export const RULE_ID = 'GG-AUTH-PAUSE-001';

export interface PausePolicy {
  /** Authorities (role constants or access-check names) allowed to pause. */
  pauseAuthorities?: string[];
  /** Authorities allowed to unpause. */
  unpauseAuthorities?: string[];
  /** Report a contract with no pause function. */
  requirePause?: boolean;
  /** Report one authority that both pauses and unpauses. */
  requireSeparation?: boolean;
}

export interface PauseAuthorityOptions {
  policy?: PausePolicy;
  maxFindings?: number;
}

const LIMITATIONS = [
  'Lexical, name-based analysis of Solidity 0.6–0.8.x source; pause/unpause functions are recognized by name.',
  'Role holders are read from grant calls in the supplied sources (constructors, initializers, functions); grants made by later transactions are not visible.',
  'Roles inherited from bases that are not in the supplied sources are not analyzed.',
  'Policy comparison uses authority names as written in the code (case-insensitive).',
];

const UNPAUSE_RE = /^(_?unpause|_?resume|_?unfreeze|_?unhalt|_?restart|emergencyUnpause)\w*$/i;
const PAUSE_RE = /^(_?pause|emergencyPause|_?halt|_?freeze|_?stop)\w*$/i;
const DEFAULT_ADMIN = 'DEFAULT_ADMIN_ROLE';

interface RoleGraph {
  roles: string[];
  grants: Array<{ role: string; grantee: string; where: string }>;
  admins: Map<string, string>;
}

function buildRoleGraph(model: ProjectModel, contract: string): RoleGraph {
  const roles = new Set<string>([DEFAULT_ADMIN]);
  for (const v of stateVarsOf(model, contract).values()) if (v.constant && /^bytes32/.test(v.valueType)) roles.add(v.name);
  const grants: RoleGraph['grants'] = [];
  const admins = new Map<string, string>();
  for (const n of mro(model, contract)) {
    for (const f of model.contracts.get(n)?.functions ?? []) {
      if (!f.hasBody) continue;
      const where = f.kind === 'constructor' ? `${n} constructor` : `${n}.${f.name}()`;
      for (const m of f.body.matchAll(/\b_?(?:grantRole|setupRole)\s*\(\s*([A-Za-z_$][\w$]*)\s*,\s*([^;]+?)\)\s*;/g)) {
        grants.push({ role: m[1], grantee: m[2].trim(), where });
        roles.add(m[1]);
      }
      for (const m of f.body.matchAll(/\b_setRoleAdmin\s*\(\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
        admins.set(m[1], m[2]);
        roles.add(m[1]);
        roles.add(m[2]);
      }
    }
  }
  return { roles: [...roles], grants, admins };
}

const norm = (s: string) => normalizeToken(s);
const holders = (g: RoleGraph, role: string) => g.grants.filter((x) => x.role === role);
const adminOf = (g: RoleGraph, role: string) => g.admins.get(role) ?? DEFAULT_ADMIN;
const authorities = (gate: Gate) => [...gate.roles, ...gate.tokens];

export function detectPauseAuthority(input: string | ProjectSource[], options: PauseAuthorityOptions = {}): RuleResult {
  const built = buildProjectModel(input);
  if (!built.ok) return { ruleId: RULE_ID, analyzed: false, findings: [], diagnostics: built.diagnostics, limitations: LIMITATIONS };
  const { model } = built;
  const diagnostics: Diagnostic[] = [...model.diagnostics];
  const limitations = [...LIMITATIONS];
  const notes: string[] = [];
  const findings: SecurityFinding[] = [];
  const emitted = new Set<string>();
  const policy = options.policy ?? {};
  const pauseAllowed = new Set((policy.pauseAuthorities ?? []).map(norm));
  const unpauseAllowed = new Set((policy.unpauseAuthorities ?? []).map(norm));
  const maxFindings = options.maxFindings ?? 100;

  for (const c of model.contracts.values()) {
    if (c.kind !== 'contract') continue;
    const missing = externalBases(model, c.name).filter((b) => !ACCESS_CONTROL_BASE_RE.test(b) && !/^Pausable/.test(b));
    if (missing.length) limitations.push(`${c.name} inherits ${missing.join(', ')}, which is not in the supplied sources; inherited behavior is not analyzed.`);
  }

  for (const a of [...model.contracts.values()].filter((c) => c.kind === 'contract')) {
    const fns = functionsOf(model, a.name).filter((f) => f.kind === 'function' && f.hasBody && isExternallyCallable(f) && isStateChanging(f));
    const unpauseFns = fns.filter((f) => UNPAUSE_RE.test(f.name));
    const pauseFns = fns.filter((f) => !UNPAUSE_RE.test(f.name) && PAUSE_RE.test(f.name));
    const graph = buildRoleGraph(model, a.name);
    const emit = (f: Omit<SecurityFinding, 'line' | 'column' | 'file'> & { file: string; offset: number }) => {
      const key = `${f.file}:${f.offset}:${f.kind}`;
      if (emitted.has(key) || findings.length >= maxFindings) return;
      emitted.add(key);
      const { offset, ...rest } = f;
      const { line, column } = lineColumn(model.files.get(f.file)!.source, offset);
      findings.push({ ...rest, line, column });
    };

    if (pauseFns.length === 0 && unpauseFns.length === 0) {
      if (policy.requirePause) {
        emit({
          ruleId: RULE_ID, kind: 'missing-emergency-pause', severity: 'medium', confidence: 'medium', file: a.file, offset: a.open, contract: a.name,
          message: `${a.name} has no pause function but the configured policy requires an emergency pause.`,
          severityRationale: 'The policy declares emergency pause mandatory; without it there is no way to halt the contract during an incident.',
          confidenceEvidence: ['no externally callable function named pause/halt/freeze', 'policy.requirePause is true'],
          remediation: 'Add a pause function restricted to a dedicated emergency role and an unpause function restricted to a separate, more conservative authority.',
          details: { policy },
        });
      }
      continue;
    }

    const gateInfo = (f: ModelFunction) => {
      const gate = gateOf(model, a.name, f);
      return { f, gate, auth: authorities(gate) };
    };
    const pauses = pauseFns.map(gateInfo);
    const unpauses = unpauseFns.map(gateInfo);

    // Role graph explanation for every role used by a pause/unpause gate.
    const used = new Set<string>([...pauses, ...unpauses].flatMap((x) => x.gate.roles));
    const graphLines: string[] = [];
    for (const role of used) {
      const h = holders(graph, role);
      const adm = adminOf(graph, role);
      graphLines.push(`${role}: admin ${adm}${graph.admins.has(role) ? '' : ' (default)'}; holders ${h.length ? h.map((x) => `${x.grantee} (${x.where})`).join(', ') : 'none granted in the supplied sources'}`);
      if (adm !== role) graphLines.push(`${adm}: holders ${holders(graph, adm).map((x) => `${x.grantee} (${x.where})`).join(', ') || 'none granted in the supplied sources'}`);
    }
    for (const x of [...pauses, ...unpauses]) graphLines.push(`${x.f.name}() requires ${x.auth.join(', ') || 'no check'}`);
    notes.push(...graphLines.map((l) => `${a.name}: ${l}`));
    const roleGraph = { roles: graph.roles, grants: graph.grants, admins: Object.fromEntries(graph.admins), explanation: graphLines };

    const base = { ruleId: RULE_ID, contract: a.name } as const;
    for (const x of unpauses) {
      const loc = { file: x.f.file, offset: x.f.offset, function: x.f.name };
      if (!isGated(x.gate)) {
        emit({ ...base, ...loc, kind: 'unpause-unrestricted', severity: 'critical', confidence: 'high',
          message: `${a.name}.${x.f.name}() has no caller restriction; anyone can lift an emergency pause.`,
          severityRationale: 'Unpausing re-enables operations the pause was meant to stop; an open unpause defeats the emergency control.',
          confidenceEvidence: ['no modifier, msg.sender comparison or role check found'],
          remediation: 'Restrict unpause to a dedicated, more conservative authority (multisig or timelocked role).', details: { roleGraph } });
        continue;
      }
      const unknown = x.auth.filter((r) => !unpauseAllowed.has(norm(r)));
      if (unpauseAllowed.size > 0 && unknown.length > 0) {
        emit({ ...base, ...loc, kind: 'unpause-broader-than-policy', severity: 'high', confidence: 'high',
          message: `${a.name}.${x.f.name}() can be called by ${unknown.join(', ')}, which is not in the documented unpause policy (${[...unpauseAllowed].join(', ')}).`,
          severityRationale: 'Unpause authority granted more broadly than policy lets a lower-trust role reverse an emergency stop.',
          confidenceEvidence: [`gate: ${x.gate.evidence.join('; ')}`, `policy.unpauseAuthorities: ${policy.unpauseAuthorities!.join(', ')}`],
          remediation: 'Gate unpause with the policy authority only and make sure no other role can grant it.', details: { roleGraph, unexpected: unknown } });
      }
      for (const role of x.gate.roles) {
        const adm = adminOf(graph, role);
        if (unpauseAllowed.size > 0 && pauseAllowed.has(norm(adm)) && !unpauseAllowed.has(norm(adm))) {
          emit({ ...base, ...loc, kind: 'unpause-role-admin-broad', severity: 'medium', confidence: 'medium',
            message: `${role} (unpause) is administered by ${adm}, a pause-only authority per policy; its holders can grant themselves unpause.`,
            severityRationale: 'Role admin control transitively grants the unpause power to the pause authority, collapsing the intended separation.',
            confidenceEvidence: [`admin of ${role} is ${adm}${graph.admins.has(role) ? ' (_setRoleAdmin)' : ' (default)'}`],
            remediation: `Call _setRoleAdmin(${role}, <unpause admin role>) so only the unpause authority manages it.`, details: { roleGraph } });
        }
        if (holders(graph, role).length === 0) {
          const adm = adminOf(graph, role);
          const lost = holders(graph, adm).length === 0;
          emit({ ...base, ...loc, kind: lost ? 'unpause-authority-lost' : 'unpause-authority-unassigned', severity: lost ? 'high' : 'low', confidence: 'medium',
            message: lost
              ? `${role} (required to unpause ${a.name}) has no holder and its admin ${adm} has none either; once paused the contract can never be unpaused.`
              : `${role} (required to unpause ${a.name}) is not granted to anyone in the supplied sources; ${adm} must grant it before unpause works.`,
            severityRationale: lost ? 'No account can ever acquire the role, so a pause is permanent.' : 'Unpause is currently unreachable until an admin grants the role.',
            confidenceEvidence: [`no grant of ${role} in constructors, initializers or functions`, `holders of ${adm}: ${holders(graph, adm).length}`],
            remediation: `Grant ${role} (or its admin) in the constructor/initializer to a multisig.`, details: { roleGraph } });
        }
      }
    }
    for (const x of pauses) {
      const loc = { file: x.f.file, offset: x.f.offset, function: x.f.name };
      if (!isGated(x.gate)) {
        emit({ ...base, ...loc, kind: 'pause-unrestricted', severity: 'high', confidence: 'high',
          message: `${a.name}.${x.f.name}() has no caller restriction; anyone can pause the contract.`,
          severityRationale: 'An open pause lets any account halt the system at will (denial of service).',
          confidenceEvidence: ['no modifier, msg.sender comparison or role check found'],
          remediation: 'Restrict pause to an emergency role.', details: { roleGraph } });
        continue;
      }
      for (const role of x.gate.roles) {
        const adm = adminOf(graph, role);
        if (holders(graph, role).length === 0 && holders(graph, adm).length === 0) {
          emit({ ...base, ...loc, kind: 'pause-authority-lost', severity: 'high', confidence: 'medium',
            message: `${role} (required to pause ${a.name}) has no holder and neither does its admin ${adm}; the emergency pause can never be used.`,
            severityRationale: 'Emergency authority that no account can hold is the same as no emergency control.',
            confidenceEvidence: [`no grant of ${role} or ${adm} in the supplied sources`],
            remediation: `Grant ${role} in the constructor/initializer to an emergency responder.`, details: { roleGraph } });
        } else if (holders(graph, role).length === 0) {
          emit({ ...base, ...loc, kind: 'pause-authority-unassigned', severity: 'low', confidence: 'medium',
            message: `${role} (required to pause ${a.name}) is not granted to anyone yet; ${adm} must grant it first.`,
            severityRationale: 'The pause works only after an admin grants the role, which a responder may not manage during an incident.',
            confidenceEvidence: [`no grant of ${role} in the supplied sources`],
            remediation: `Grant ${role} at deployment.`, details: { roleGraph } });
        }
      }
      if (pauseAllowed.size > 0) {
        const unknown = x.auth.filter((r) => !pauseAllowed.has(norm(r)));
        if (unknown.length > 0) {
          emit({ ...base, ...loc, kind: 'pause-broader-than-policy', severity: 'medium', confidence: 'high',
            message: `${a.name}.${x.f.name}() can be called by ${unknown.join(', ')}, outside the documented pause policy.`,
            severityRationale: 'Pause authority wider than policy increases the chance of abuse of the emergency control.',
            confidenceEvidence: [`gate: ${x.gate.evidence.join('; ')}`], remediation: 'Limit pause to the policy authorities.', details: { roleGraph, unexpected: unknown } });
        }
      }
    }
    if (policy.requireSeparation) {
      for (const p of pauses) for (const u of unpauses) {
        const shared = p.auth.filter((r) => u.auth.some((q) => norm(q) === norm(r)));
        if (shared.length > 0) {
          emit({ ...base, file: u.f.file, offset: u.f.offset, function: u.f.name, kind: 'pause-unpause-not-separated', severity: 'low', confidence: 'high',
            message: `${a.name}: ${shared.join(', ')} can both pause and unpause; policy requires separate authorities.`,
            severityRationale: 'One compromised key can both stop and restart the system.',
            confidenceEvidence: [`${p.f.name}() and ${u.f.name}() share ${shared.join(', ')}`],
            remediation: 'Use a fast pauser role and a separate, slower unpause authority.', details: { roleGraph, shared } });
        }
      }
    }
  }
  return { ruleId: RULE_ID, analyzed: true, findings, diagnostics, limitations, notes };
}
