/**
 * GG-AUTH-INHERIT-001: authorization checks bypassed through inherited entry points.
 *
 * Resolves inheritance with solidity-inheritance (C3 linearization, effective
 * functions and modifiers) and reports three ways an access check disappears
 * once contracts are combined:
 *
 *   override-drops-auth            a derived override of a guarded function is an
 *                                  external entry point with no access check and
 *                                  does not call super
 *   modifier-override-weakens-auth a derived modifier replaces a base modifier that
 *                                  checked msg.sender with a body that does not
 *   unguarded-sibling-entry        an inherited unguarded entry point reaches the
 *                                  same sensitive internal function as a guarded
 *                                  entry point of another contract
 *
 * Supported: Solidity 0.6 - 0.8.x, bases defined in the analyzed source only.
 * Imported bases (OpenZeppelin and similar) are not resolved, so their checks
 * are neither assumed nor reported. See docs/rules/auth-inherited-entry-bypass.md.
 */

import {
  type Diagnostic,
  type RuleResult,
  type SecurityFinding,
  type SolFunction,
  makeFinding,
  prepareSource,
} from '../lib/solidity-lite';
import {
  type ContractModel,
  buildSourceModel,
  calleesOf,
  modifierExecutionOrder,
  signatureOf,
} from '../lib/solidity-inheritance';

export const RULE_ID = 'GG-AUTH-INHERIT-001';

export const LIMITATIONS = [
  'Only bases defined in the analyzed source are resolved; imported bases are never guessed at.',
  'An access check is recognised by modifier names, msg.sender guards and a short list of check helpers; custom schemes can be missed.',
  'Reachability of an internal function is followed one call level deep.',
];

const AUTH_MODIFIER_RE = /^(only|auth|restricted|requires?|isOwner|isAdmin|whenAuthorized)/i;
const AUTH_GUARD_RE = /\b(?:require|assert|if)\s*\([^;]*?(?:msg\.sender|_msgSender\s*\(\s*\))/;
const AUTH_HELPER_RE = /\b(?:_checkOwner|_checkRole|_requireAuth|_onlyOwner|_requireOwner|_authorize\w*|hasRole)\s*\(/;
const SENSITIVE_RE = /^_?(set|mint|burn|withdraw|transfer|upgrade|pause|unpause|grant|revoke|sweep|rescue|initialize)\w*$/i;

function textChecksCaller(text: string): boolean {
  return AUTH_GUARD_RE.test(text) || AUTH_HELPER_RE.test(text);
}

function authEvidence(model: ContractModel, fn: SolFunction): string[] {
  const out: string[] = [];
  for (const step of modifierExecutionOrder(model, fn)) {
    if (AUTH_MODIFIER_RE.test(step.name) || textChecksCaller(step.before)) out.push(`modifier ${step.name}`);
  }
  if (textChecksCaller(fn.body)) out.push('caller check in the function body');
  for (const callee of calleesOf(model, fn)) {
    if (callee !== fn && /^_?(check|require|only|auth)/i.test(callee.name) && textChecksCaller(callee.body)) {
      out.push(`helper ${callee.name}()`);
    }
  }
  return out;
}

function isEntry(f: SolFunction): boolean {
  return (
    f.kind === 'function' &&
    f.hasBody &&
    (f.visibility === 'public' || f.visibility === 'external') &&
    f.mutability !== 'view' &&
    f.mutability !== 'pure'
  );
}

export function detectInheritedAuthBypass(input: unknown): RuleResult {
  const prep = prepareSource(input);
  if (!prep.ok) return { ruleId: RULE_ID, analyzed: false, findings: [], diagnostics: prep.diagnostics };
  const { source, masked } = prep.prepared;
  const diagnostics: Diagnostic[] = [...prep.diagnostics];
  const findings: SecurityFinding[] = [];
  const reported = new Set<string>();

  try {
    const model = buildSourceModel(masked, source, diagnostics);
    for (const cm of model.contracts.values()) {
      if (cm.linearization.length < 2) continue;

      const signatures = new Set<string>();
      for (const fns of cm.own.values()) for (const f of fns) signatures.add(signatureOf(f));

      for (const sig of signatures) {
        const decls = cm.linearization.flatMap((l) => (cm.own.get(l.name) ?? []).filter((f) => signatureOf(f) === sig));
        if (decls.length < 2) continue;
        const [effective, ...bases] = decls;
        if (!isEntry(effective) || /\bsuper\s*\.\s*[\w$]+\s*\(/.test(effective.body)) continue;
        if (authEvidence(cm, effective).length > 0) continue;
        const guarded = bases.find((b) => isEntry(b) && authEvidence(cm, b).length > 0);
        const key = `override:${effective.offset}`;
        if (!guarded || reported.has(key)) continue;
        reported.add(key);
        findings.push(
          makeFinding(source, effective.offset, {
            ruleId: RULE_ID,
            contract: effective.contract,
            function: effective.name,
            kind: 'override-drops-auth',
            severity: 'high',
            confidence: 'high',
            message: `${effective.contract}.${effective.name}() overrides ${guarded.contract}.${guarded.name}(), which is access controlled, but the override has no access check and does not call super.`,
            severityRationale: 'Anyone can call the override and reach the privileged behavior the base contract protected.',
            confidenceEvidence: [`base ${guarded.contract} guard: ${authEvidence(cm, guarded).join(', ')}`, 'the override has no caller check, no auth modifier and no super call'],
            remediation: 'Add the same access modifier to the override or call super.' + guarded.name + '() so the base check runs.',
            details: { base: guarded.contract, signature: sig },
          }),
        );
      }

      const modifiersByName = new Map<string, SolFunction[]>();
      for (const l of cm.linearization) {
        for (const f of model.allFunctions) {
          if (f.kind !== 'modifier' || f.contract !== l.name) continue;
          modifiersByName.set(f.name, [...(modifiersByName.get(f.name) ?? []), f]);
        }
      }
      for (const [name, decls] of modifiersByName) {
        if (decls.length < 2) continue;
        const [effective, ...bases] = decls;
        const guarded = bases.find((b) => textChecksCaller(b.body));
        const key = `modifier:${effective.offset}`;
        if (!guarded || textChecksCaller(effective.body) || reported.has(key)) continue;
        reported.add(key);
        findings.push(
          makeFinding(source, effective.offset, {
            ruleId: RULE_ID,
            contract: effective.contract,
            function: name,
            kind: 'modifier-override-weakens-auth',
            severity: 'high',
            confidence: 'medium',
            message: `Modifier ${name} in ${effective.contract} replaces ${guarded.contract}.${name}, which checked the caller, with a body that does not; every function using it loses the check.`,
            severityRationale: 'One weakened modifier silently removes access control from all functions that rely on it.',
            confidenceEvidence: [`${guarded.contract}.${name} checks msg.sender or calls a check helper`, `${effective.contract}.${name} does neither`],
            remediation: 'Keep the caller check in the override or rename the modifier so it is not mistaken for the guarded one.',
            details: { base: guarded.contract },
          }),
        );
      }

      const guardedCallees = new Map<SolFunction, SolFunction>();
      for (const g of cm.functions) {
        if (!isEntry(g) || authEvidence(cm, g).length === 0) continue;
        for (const callee of calleesOf(cm, g)) if (!guardedCallees.has(callee)) guardedCallees.set(callee, g);
      }
      for (const f of cm.functions) {
        if (!isEntry(f) || authEvidence(cm, f).length > 0) continue;
        for (const callee of calleesOf(cm, f)) {
          const g = guardedCallees.get(callee);
          const key = `sibling:${f.offset}:${callee.offset}`;
          if (!g || g.contract === f.contract || !SENSITIVE_RE.test(callee.name) || reported.has(key)) continue;
          reported.add(key);
          findings.push(
            makeFinding(source, f.offset, {
              ruleId: RULE_ID,
              contract: f.contract,
              function: f.name,
              kind: 'unguarded-sibling-entry',
              severity: 'medium',
              confidence: 'medium',
              message: `${f.contract}.${f.name}() has no access check but reaches ${callee.name}(), which ${g.contract}.${g.name}() only exposes behind an access check.`,
              severityRationale: 'The sensitive internal logic is protected on one inherited path and open on another.',
              confidenceEvidence: [`${g.contract}.${g.name}() is guarded: ${authEvidence(cm, g).join(', ')}`, `${f.name}() reaches the same ${callee.name}() without a check`],
              remediation: `Protect ${f.name}() with the same access control or move the check into ${callee.name}().`,
              details: { sharedInternal: callee.name, guardedEntry: g.name },
            }),
          );
        }
      }
    }
  } catch {
    diagnostics.push({ level: 'error', code: 'internal-error', message: 'Analysis stopped on unsupported input; findings may be incomplete.' });
  }

  findings.sort((a, b) => a.line - b.line || a.column - b.column || a.kind.localeCompare(b.kind));
  return { ruleId: RULE_ID, analyzed: true, findings, diagnostics };
}
