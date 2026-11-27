/**
 * GG-AUTH-LOCKOUT-001 — Ownership and role-transfer flows that can lock a contract out of administration.
 *
 * Models, per contract (inheritance and internal helpers followed, multi-file by contract name):
 *   - single-step transfers (`owner = newOwner`) with no recovery path; the zero address or a mistyped
 *     address permanently removes the only administrator (`single-step-owner-transfer`)
 *   - two-step flows: acceptance not restricted to the pending owner (`pending-accept-unrestricted`),
 *     acceptance done by someone other than the pending owner (`pending-accept-not-by-pending`),
 *     a pending owner that nothing can ever accept (`pending-acceptance-missing`)
 *   - renunciation: explicit `owner = address(0)` or an inherited, un-overridden `renounceOwnership`
 *     (`ownership-renounce-lockout`)
 *   - final-administrator removal through custom admin mappings (`last-admin-removable`,
 *     `last-admin-renounceable`) and inherited OpenZeppelin AccessControl (`last-admin-removable`, low)
 *
 * Intentional designs are not reported: a contract with no privileged functions is permanently permissionless,
 * and a comment on the contract or function documenting immutability / ownerlessness / intentional renounce
 * (or the `intentionallyImmutable` option) suppresses lockout findings; the decision is recorded in `notes`.
 * A second authority that can reset the owner counts as a recovery path and lowers severity.
 *
 * Supported: Solidity 0.6 – 0.8.x source text (string or `{ path, content }[]`). Compiler settings and project
 * configuration are never read or trusted. Limitations: lexical, name based (authority = identifiers compared with
 * msg.sender or named owner/admin/...); frameworks are recognized by base-contract name only; who holds a role at
 * runtime is not visible. See docs/rules/solidity-authorization.md.
 */
import { Diagnostic, RuleResult, SecurityFinding, Severity, lineColumn, mentions, statementsOf } from '../lib/solidity-lite';
import {
  ModelFunction,
  ProjectSource,
  TimelineEvent,
  buildProjectModel,
  buildTimeline,
  functionsOf,
  isExternallyCallable,
  isStateChanging,
  stateVarsOf,
  unresolvedBases,
} from '../lib/project-model';
import {
  ACCESS_CONTROL_BASE_RE,
  AUTH_NAME_RE,
  DEFAULT_ADMIN_RULES_RE,
  Gate,
  OWNABLE_BASE_RE,
  documentedIntent,
  externalBases,
  gateOf,
  isGated,
  normalizeToken,
} from '../lib/authority-model';

export const RULE_ID = 'GG-AUTH-LOCKOUT-001';

export interface AuthorityLockoutOptions {
  /** Contract names that are immutable / ownerless by design. */
  intentionallyImmutable?: string[];
  maxFindings?: number;
}

const LIMITATIONS = [
  'Lexical, name-based analysis of Solidity 0.6–0.8.x source; authority is inferred from identifiers compared with msg.sender and from owner/admin-style names.',
  'Frameworks (Ownable, Ownable2Step, AccessControl, ...) are recognized by base-contract name only; their code is not analyzed.',
  'Who holds a role or owner key at runtime, and off-chain recovery (multisig, proxy admin), are not visible.',
  'Branches are flattened; a guard on one branch may be treated as covering the whole function.',
];

const PENDING_RE = /(pending|proposed|nominat|candidate|^_?new(owner|admin))/i;
const CRITICAL_OPS_RE = /(unpause|withdraw|rescue|recover|sweep|upgrade|emergency|migrate)/i;
const FINALIZE_RE = /(finaliz|configured|initialized|sealed|frozen|ready|setupComplete)/i;
const COUNT_GUARD_RE = /(count|length|getRoleMemberCount|numAdmins|totalAdmins)/i;

interface Write {
  variable: string;
  rhs: string;
  key?: string;
  deleted: boolean;
  event: TimelineEvent;
}

function parseWrite(e: TimelineEvent): Write {
  const t = e.text.trim();
  if (/^delete\s/.test(t)) return { variable: e.variable!, rhs: '', deleted: true, event: e };
  const m = /^[A-Za-z_$][\w$]*((?:\s*\[[^\]]*\])*)\s*(?:[-+*/%|&^]|<<|>>)?=(?![=>])\s*([\s\S]*)$/.exec(t);
  const key = m ? /\[([^\]]*)\]\s*$/.exec(m[1])?.[1]?.trim() : undefined;
  return { variable: e.variable!, rhs: m ? m[2].trim() : '', key, deleted: false, event: e };
}

const isZero = (rhs: string) => /^(address\s*\(\s*0\s*\)|0x0+|0)$/.test(rhs.trim());
const isSender = (s: string) => /^(msg\.sender|_msgSender\s*\(\s*\))$/.test(s.trim());

export function detectAuthorityLockout(input: string | ProjectSource[], options: AuthorityLockoutOptions = {}): RuleResult {
  const built = buildProjectModel(input);
  if (!built.ok) return { ruleId: RULE_ID, analyzed: false, findings: [], diagnostics: built.diagnostics, limitations: LIMITATIONS };
  const { model } = built;
  const diagnostics: Diagnostic[] = [...model.diagnostics];
  const limitations = [...LIMITATIONS];
  const notes: string[] = [];
  const findings: SecurityFinding[] = [];
  const emitted = new Set<string>();
  const immutable = new Set(options.intentionallyImmutable ?? []);
  const maxFindings = options.maxFindings ?? 100;

  const emit = (f: Omit<SecurityFinding, 'line' | 'column' | 'file'> & { file: string; offset: number }) => {
    const key = `${f.file}:${f.offset}:${f.kind}`;
    if (emitted.has(key) || findings.length >= maxFindings) return;
    emitted.add(key);
    const { offset, ...rest } = f;
    const { line, column } = lineColumn(model.files.get(f.file)!.source, offset);
    findings.push({ ...rest, line, column });
  };

  const concrete = [...model.contracts.values()].filter((c) => c.kind === 'contract');
  for (const c of concrete) {
    const missing = unresolvedBases(model, c.name).filter((b) => !OWNABLE_BASE_RE.test(b) && !ACCESS_CONTROL_BASE_RE.test(b));
    if (missing.length) limitations.push(`${c.name} inherits ${missing.join(', ')}, which is not in the supplied sources; inherited behavior is not analyzed.`);
  }

  for (const a of concrete) {
    const states = stateVarsOf(model, a.name);
    const ext = externalBases(model, a.name);
    const fns = functionsOf(model, a.name).filter((f) => f.kind === 'function' && f.hasBody);
    const gates = new Map<ModelFunction, Gate>(fns.map((f) => [f, gateOf(model, a.name, f)]));
    const tokens = new Set([...gates.values()].flatMap((g) => g.tokens));
    const stateOf = (name: string) => states.get(name);
    const addressVars = [...states.values()].filter((s) => /^address\b/.test(s.valueType) && !s.type.includes('mapping'));
    const pendingVars = addressVars.filter((s) => PENDING_RE.test(s.name)).map((s) => s.name);
    const ownerVars = addressVars.filter((s) => !PENDING_RE.test(s.name) && (tokens.has(normalizeToken(s.name)) || AUTH_NAME_RE.test(s.name)) && !s.constant).map((s) => s.name);
    const adminMaps = [...states.values()].filter((s) => s.type.includes('mapping') && s.valueType === 'bool' && (AUTH_NAME_RE.test(s.name) || /roles?$/i.test(s.name))).map((s) => s.name);
    const counters = [...states.values()].filter((s) => /^u?int/.test(s.valueType) && /(admin|owner)\w*(count|num|total)|num(admins|owners)/i.test(s.name)).map((s) => s.name);

    const facts = fns.map((f) => {
      const tl = buildTimeline(model, a.name, f);
      const writes = tl.events.filter((e) => e.kind === 'write').map(parseWrite);
      const src = model.files.get(f.file)!.source;
      const guards = statementsOf(f, src).map((s) => s.text).filter((t) => /^(require|assert|if|revert)\b/.test(t));
      for (const m of f.modifiers) {
        const mod = functionsOf(model, a.name).find((x) => x.kind === 'modifier' && x.name === m);
        if (mod) guards.push(mod.body);
      }
      return { f, writes, guards, gate: gates.get(f)! };
    });

    const authorityWrite = (w: Write) => ownerVars.includes(w.variable) || pendingVars.includes(w.variable) || adminMaps.includes(w.variable);
    const privileged = facts.filter((x) => isExternallyCallable(x.f) && isStateChanging(x.f) && isGated(x.gate) && !x.writes.some(authorityWrite) && !/(grant|revoke|renounce)Role|Owner(ship)?$|Admin$/i.test(x.f.name));
    const criticalOps = privileged.some((x) => CRITICAL_OPS_RE.test(x.f.name));
    if (privileged.length === 0) {
      if (facts.some((x) => x.writes.some(authorityWrite) || ext.length)) notes.push(`${a.name}: no privileged functions; treated as permissionless, no lockout findings.`);
      continue;
    }
    const contractIntent = immutable.has(a.name) ? 'listed in intentionallyImmutable' : documentedIntent(model, a);
    if (contractIntent) notes.push(`${a.name}: lockout findings suppressed, intent documented (${String(contractIntent).replace(/\s+/g, ' ').slice(0, 80)}).`);

    const recoveryFor = (self: ModelFunction, v: string): boolean =>
      facts.some((x) => x.f !== self && isExternallyCallable(x.f) && x.writes.some((w) => w.variable === v) && isGated(x.gate) && !x.gate.tokens.includes(normalizeToken(v)));
    const base = { contract: a.name };

    for (const x of facts) {
      if (!isExternallyCallable(x.f)) continue;
      const paramNames = x.f.params.map((p) => p.name).filter(Boolean);
      const mentionsPending = pendingVars.some((p) => mentions(x.f.body, p));
      for (const w of x.writes) {
        const file = w.event.file;
        const loc = { file, offset: w.event.offset, function: x.f.name };
        const fnIntent = contractIntent ?? documentedIntent(model, a, x.f);
        if (ownerVars.includes(w.variable)) {
          if (w.deleted || isZero(w.rhs)) {
            // Renounce
            if (fnIntent) {
              if (!contractIntent) notes.push(`${a.name}.${x.f.name}(): renounce treated as intentional (documented).`);
              continue;
            }
            const finalized = x.guards.some((g) => FINALIZE_RE.test(g));
            const recovery = recoveryFor(x.f, w.variable);
            const sev: Severity = recovery || finalized ? 'low' : criticalOps ? 'high' : 'medium';
            emit({
              ...base, ...loc, ruleId: RULE_ID, kind: 'ownership-renounce-lockout', severity: sev, confidence: finalized ? 'medium' : 'high',
              message: `${a.name}.${x.f.name}() can set ${w.variable} to the zero address; every function gated by it (${privileged.slice(0, 3).map((p) => p.f.name + '()').join(', ')}) becomes permanently uncallable.`,
              severityRationale: `${criticalOps ? 'Critical operations (unpause, withdraw, upgrade, recovery) are among the gated functions. ' : ''}${recovery ? 'A second authority can reset the owner, which lowers the impact. ' : 'No second authority can restore the owner. '}${finalized ? 'Renounce is guarded by a finalization flag, which suggests a deliberate step.' : ''}`,
              confidenceEvidence: [`${w.variable} assigned ${w.deleted ? 'by delete' : w.rhs} at ${file}:${w.event.line}`, `${privileged.length} privileged function(s) depend on it`, recovery ? 'recovery authority found' : 'no recovery authority found'],
              remediation: 'Remove the renounce path, require a two-step confirmation or delay, or document the contract as intentionally ownerless; keep a recovery authority (timelock or guardian) able to restore the owner.',
              details: { renounceFunction: x.f.name, privilegedFunctions: privileged.map((p) => p.f.name), recoveryPath: recovery, finalizationGuard: finalized },
            });
          } else if (isSender(w.rhs) || pendingVars.some((p) => mentions(w.rhs, p)) || (mentionsPending && paramNames.length === 0)) {
            // Acceptance
            const senderGuard = [...x.guards, ...x.f.modifiers].some((g) => /pending|nominee/i.test(g) && /msg\.sender|_msgSender/.test(g) || pendingVars.some((p) => new RegExp(`(msg\\.sender|_msgSender\\s*\\(\\s*\\))\\s*[!=]=\\s*${p}\\b|\\b${p}\\s*[!=]=\\s*(msg\\.sender|_msgSender\\s*\\(\\s*\\))`).test(g)) || /^onlyPending/i.test(g));
            const ownerGated = x.gate.tokens.some((t) => ownerVars.map(normalizeToken).includes(t));
            if (!senderGuard && !ownerGated) {
              emit({
                ...base, ...loc, ruleId: RULE_ID, kind: 'pending-accept-unrestricted', severity: 'critical', confidence: 'high',
                message: `${a.name}.${x.f.name}() assigns ${w.variable} but does not require msg.sender to be the pending owner; any account can take ownership.`,
                severityRationale: 'The acceptance step is the only proof that the new address is controlled by its owner; without it the flow is an open takeover.',
                confidenceEvidence: [`write to ${w.variable} at ${file}:${w.event.line}`, 'no msg.sender comparison with the pending variable in the function or its modifiers'],
                remediation: 'Add require(msg.sender == pendingOwner) and clear pendingOwner after acceptance.',
                details: { acceptFunction: x.f.name, pendingVariables: pendingVars },
              });
            } else if (!senderGuard && ownerGated) {
              emit({
                ...base, ...loc, ruleId: RULE_ID, kind: 'pending-accept-not-by-pending', severity: 'medium', confidence: 'medium',
                message: `${a.name}.${x.f.name}() is gated by the current owner, so the pending owner never proves it controls its key; a mistyped pending address still transfers ownership.`,
                severityRationale: 'A two-step flow only prevents wrong-address lockout when the recipient must confirm.',
                confidenceEvidence: [`gated by ${x.gate.tokens.join(', ')}`, 'no pending-owner sender check'],
                remediation: 'Require msg.sender == pendingOwner in the acceptance function.',
                details: { acceptFunction: x.f.name },
              });
            }
          } else if (paramNames.some((p) => mentions(w.rhs, p)) || x.writes.length > 0) {
            // Direct (single-step) transfer
            if (fnIntent) continue;
            const guardsText = x.guards.join('\n');
            const zeroChecked = /address\s*\(\s*0\s*\)|0x0{40}/.test(guardsText);
            const recovery = recoveryFor(x.f, w.variable);
            const sev: Severity = recovery ? 'low' : zeroChecked ? 'medium' : 'high';
            emit({
              ...base, ...loc, ruleId: RULE_ID, kind: 'single-step-owner-transfer', severity: sev, confidence: 'high',
              message: `${a.name}.${x.f.name}() sets ${w.variable} directly from its argument${zeroChecked ? '' : ' without a zero-address check'}; a wrong address permanently removes the only administrator.`,
              severityRationale: `${recovery ? 'A second authority can restore the owner. ' : 'There is no recovery path. '}${zeroChecked ? 'The zero address is rejected, but a mistyped non-zero address is not recoverable.' : 'Even the zero address is accepted.'}`,
              confidenceEvidence: [`direct assignment at ${file}:${w.event.line}`, zeroChecked ? 'zero-address check present' : 'no zero-address check', recovery ? 'recovery authority found' : 'no recovery authority found'],
              remediation: 'Use a two-step transfer: store a pendingOwner and let that address call acceptOwnership(), then clear it. Reject the zero address.',
              details: { transferFunction: x.f.name, zeroAddressChecked: zeroChecked, recoveryPath: recovery },
            });
          }
        }
        // Last-admin removal through admin mappings.
        if (adminMaps.includes(w.variable) && (w.deleted || w.rhs === 'false') && !fnIntent) {
          const selfRemoval = !!w.key && isSender(w.key);
          const keyIsParam = !!w.key && paramNames.includes(w.key);
          const guardsText = x.guards.join('\n');
          const countGuard = COUNT_GUARD_RE.test(guardsText) || counters.some((c) => mentions(guardsText, c));
          const notSelf = !!w.key && new RegExp(`\\b${w.key}\\s*!=\\s*(msg\\.sender|_msgSender\\s*\\(\\s*\\))|(msg\\.sender|_msgSender\\s*\\(\\s*\\))\\s*!=\\s*${w.key}\\b`).test(guardsText);
          if (countGuard || (keyIsParam && notSelf)) continue;
          if (!selfRemoval && !keyIsParam) continue;
          const kind = selfRemoval ? 'last-admin-renounceable' : 'last-admin-removable';
          const recovery = facts.some((y) => y.f !== x.f && y.writes.some((z) => z.variable === w.variable && z.rhs === 'true') && isGated(y.gate) && !y.gate.tokens.includes(normalizeToken(w.variable)));
          emit({
            ...base, ...loc, ruleId: RULE_ID, kind, severity: recovery ? 'low' : criticalOps ? 'high' : 'medium', confidence: 'high',
            message: `${a.name}.${x.f.name}() clears ${w.variable}[${w.key ?? '…'}] with no check that another administrator remains; the last administrator can ${selfRemoval ? 'renounce' : 'remove themself'} and leave the contract unmanageable.`,
            severityRationale: `${recovery ? 'A separate authority can add administrators. ' : 'Nothing can add an administrator afterwards. '}Neither an admin counter nor a caller != target check protects the final entry.`,
            confidenceEvidence: [`${w.variable} cleared at ${file}:${w.event.line}`, selfRemoval ? 'key is msg.sender' : 'key is a parameter and may equal msg.sender', 'no admin count guard'],
            remediation: 'Track an admin count and require it to stay above one, forbid removing yourself, or route removal through a two-step/timelocked flow.',
            details: { removalFunction: x.f.name, selfRemoval, recoveryPath: recovery },
          });
        }
      }
    }

    // Pending owner that nothing can accept.
    const accepts = facts.some((x) => x.writes.some((w) => ownerVars.includes(w.variable) && (isSender(w.rhs) || pendingVars.some((p) => mentions(w.rhs, p)))) || (pendingVars.some((p) => mentions(x.f.body, p)) && x.writes.some((w) => ownerVars.includes(w.variable))));
    for (const x of facts) {
      const proposes = x.writes.find((w) => pendingVars.includes(w.variable) && !isZero(w.rhs) && !w.deleted);
      if (proposes && !accepts && !contractIntent) {
        emit({
          ...base, ruleId: RULE_ID, kind: 'pending-acceptance-missing', severity: 'medium', confidence: 'medium', file: proposes.event.file, offset: proposes.event.offset, function: x.f.name,
          message: `${a.name}.${x.f.name}() stores a pending owner but no function promotes it to ${ownerVars[0] ?? 'the owner'}; the transfer can never complete.`,
          severityRationale: 'The two-step flow is half implemented, so ownership cannot be moved and the pending value gives a false sense of a working handover.',
          confidenceEvidence: [`${proposes.variable} written at ${proposes.event.file}:${proposes.event.line}`, 'no write of the owner from the pending variable or msg.sender'],
          remediation: 'Add an acceptOwnership() that requires msg.sender == pendingOwner, assigns owner and clears pendingOwner.',
          details: { proposeFunction: x.f.name },
        });
      }
    }

    // Inherited frameworks (by name).
    const decl = { file: a.file, offset: a.open };
    const over = (name: string) => fns.find((f) => f.name === name && f.contractName !== undefined && model.contracts.get(f.contractName)?.kind === 'contract');
    if (ext.some((b) => OWNABLE_BASE_RE.test(b)) && !contractIntent) {
      const r = over('renounceOwnership');
      const disabled = r && /\brevert\b|require\s*\(\s*false/.test(r.body) && !/super\.renounceOwnership/.test(r.body);
      const writesZero = r && facts.some((x) => x.f === r && x.writes.some((w) => isZero(w.rhs)));
      if (!disabled && !writesZero && !documentedIntent(model, a, r)) {
        const where = r ? { file: r.file, offset: r.offset } : decl;
        emit({
          ...base, ...where, ruleId: RULE_ID, kind: 'ownership-renounce-lockout', severity: criticalOps ? 'high' : 'medium', confidence: 'medium', function: 'renounceOwnership',
          message: `${a.name} inherits renounceOwnership() and does not disable it; calling it leaves every owner-gated function (${privileged.slice(0, 3).map((p) => p.f.name + '()').join(', ')}) permanently uncallable.`,
          severityRationale: 'One call by the owner (or a compromised or mistaken owner key) removes all administration with no recovery.',
          confidenceEvidence: [`inherits ${ext.filter((b) => OWNABLE_BASE_RE.test(b)).join(', ')}`, r ? 'overridden but still delegates to super' : 'not overridden', `${privileged.length} owner-gated function(s)`],
          remediation: 'Override renounceOwnership() to revert, or document the contract as intentionally ownerless.',
          details: { inherited: true, privilegedFunctions: privileged.map((p) => p.f.name) },
        });
      }
      if (!ext.some((b) => /Ownable2Step/.test(b)) && !over('transferOwnership')) {
        emit({
          ...base, ...decl, ruleId: RULE_ID, kind: 'single-step-owner-transfer', severity: 'low', confidence: 'medium', function: 'transferOwnership',
          message: `${a.name} inherits single-step Ownable.transferOwnership(); transferring to a mistyped address permanently removes the owner.`,
          severityRationale: 'The framework rejects only the zero address; any other wrong address is unrecoverable.',
          confidenceEvidence: [`inherits ${ext.filter((b) => OWNABLE_BASE_RE.test(b)).join(', ')}`, 'transferOwnership not overridden'],
          remediation: 'Inherit Ownable2Step so the new owner must accept.',
          details: { inherited: true },
        });
      }
    }
    if (ext.some((b) => ACCESS_CONTROL_BASE_RE.test(b)) && !ext.some((b) => DEFAULT_ADMIN_RULES_RE.test(b)) && !contractIntent) {
      const usesDefaultAdmin = privileged.some((p) => p.gate.roles.includes('DEFAULT_ADMIN_ROLE')) || fns.some((f) => /_(grantRole|setupRole)\s*\(\s*DEFAULT_ADMIN_ROLE/.test(f.body)) || model.contracts.get(a.name)!.functions.some((f) => /_(grantRole|setupRole)\s*\(\s*DEFAULT_ADMIN_ROLE/.test(f.body));
      const guarded = fns.some((f) => /^(revokeRole|renounceRole|_revokeRole)$/.test(f.name) && /DEFAULT_ADMIN_ROLE/.test(f.body) && /(revert|require|getRoleMemberCount)/.test(f.body));
      if (usesDefaultAdmin && !guarded) {
        emit({
          ...base, ...decl, ruleId: RULE_ID, kind: 'last-admin-removable', severity: 'low', confidence: 'medium', function: 'revokeRole',
          message: `${a.name} inherits AccessControl; revokeRole/renounceRole can remove the last DEFAULT_ADMIN_ROLE holder and leave the contract without an administrator.`,
          severityRationale: 'The framework does not prevent removing the final admin; impact depends on what DEFAULT_ADMIN_ROLE controls.',
          confidenceEvidence: [`inherits ${ext.filter((b) => ACCESS_CONTROL_BASE_RE.test(b)).join(', ')}`, 'no override protecting DEFAULT_ADMIN_ROLE'],
          remediation: 'Use AccessControlDefaultAdminRules, or override revokeRole/renounceRole to refuse removing the last DEFAULT_ADMIN_ROLE member.',
          details: { inherited: true },
        });
      }
    }
  }
  return { ruleId: RULE_ID, analyzed: true, findings, diagnostics, limitations, notes };
}
