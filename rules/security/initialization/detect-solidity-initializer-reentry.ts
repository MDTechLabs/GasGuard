/**
 * GG-INIT-REENTRY-001: initializer re-entry and repeated initialization paths.
 *
 * For Solidity initializers (`initialize`, `init`, `setup`, `__X_init`) the rule
 * reports the paths that let initialization run more than once:
 *
 *   unguarded-initializer        an external initializer has no initializer
 *                                modifier and no initialized-flag or zero-owner
 *                                guard, so anyone can call it again
 *   public-chained-initializer   a `__X_init` function is public or external
 *                                and not protected by onlyInitializing
 *   flag-set-after-external-call the initialized flag is written after an
 *                                external call, so the call can re-enter and
 *                                initialize again
 *   missing-disable-initializers an upgradeable implementation uses the
 *                                initializer modifier but its constructor does
 *                                not call _disableInitializers()
 *
 * This is the Solidity counterpart of the Soroban-only
 * detect-unprotected-initializers. Supported: Solidity 0.6 - 0.8.x, single
 * file; guards in called helpers are not followed.
 * See docs/rules/init-reentry-repeated-initialization.md.
 */

import {
  type Diagnostic,
  type RuleResult,
  type SecurityFinding,
  extractContracts,
  extractFunctions,
  makeFinding,
  prepareSource,
  statementsOf,
} from '../lib/solidity-lite';

export const RULE_ID = 'GG-INIT-REENTRY-001';

export const LIMITATIONS = [
  'Guards inside called helpers or inherited modifiers other than the OpenZeppelin names are not followed.',
  'External calls are recognised by method name (call, delegatecall, send, transfer, transferFrom, safeTransfer*, approve, mint, initialize*).',
  'The constructor check only looks at the contract itself, not at constructors of its bases.',
];

const INIT_NAME_RE = /^(initialize\w*|init|setup|__\w+_init(_unchained)?)$/i;
const CHAINED_RE = /^__\w+_init(_unchained)?$/;
const GUARD_MODIFIER_RE = /^(initializer|reinitializer|onlyInitializing|once|onlyOnce|notInitialized|whenNotInitialized)/;
const BODY_GUARD_RE = /\b(?:require|assert|if)\s*\([^;]*?(?:initiali[sz]ed|_init\b|owner\s*==\s*address\s*\(\s*0\s*\)|admin\s*==\s*address\s*\(\s*0\s*\))/i;
const FLAG_WRITE_RE = /\b_?(?:initiali[sz]ed|isInitiali[sz]ed|inited)\s*=\s*true\b/i;
const EXTERNAL_CALL_RE = /\.\s*(?:call|delegatecall|send|transfer|transferFrom|safeTransfer\w*|approve|mint|initialize\w*)\s*[({]/;

export function detectInitializerReentry(input: unknown): RuleResult {
  const prep = prepareSource(input);
  if (!prep.ok) return { ruleId: RULE_ID, analyzed: false, findings: [], diagnostics: prep.diagnostics };
  const { source, masked } = prep.prepared;
  const diagnostics: Diagnostic[] = [...prep.diagnostics];
  const findings: SecurityFinding[] = [];

  try {
    const contracts = extractContracts(masked, diagnostics);
    const functions = extractFunctions(masked, source, contracts, diagnostics);
    const inherited = new Set<string>();
    for (const c of contracts) for (const b of c.bases) inherited.add(b);

    for (const fn of functions) {
      if (fn.kind !== 'function' || !fn.hasBody || !INIT_NAME_RE.test(fn.name)) continue;
      const external = fn.visibility === 'public' || fn.visibility === 'external';
      const modifierGuard = fn.modifiers.some((m) => GUARD_MODIFIER_RE.test(m));
      const base = { ruleId: RULE_ID, contract: fn.contract, function: fn.name };

      if (external && !modifierGuard && !BODY_GUARD_RE.test(fn.body)) {
        const chained = CHAINED_RE.test(fn.name);
        findings.push(
          makeFinding(source, fn.offset, {
            ...base,
            kind: chained ? 'public-chained-initializer' : 'unguarded-initializer',
            severity: 'high',
            confidence: chained ? 'high' : 'medium',
            message: chained
              ? `${fn.name}() is ${fn.visibility} and not protected by onlyInitializing, so anyone can call a base initializer again.`
              : `${fn.name}() is ${fn.visibility} with no initializer modifier and no initialized-flag or zero-owner check, so it can run more than once.`,
            severityRationale: 'A repeatable initializer lets an attacker overwrite the owner and other privileged state.',
            confidenceEvidence: ['initializer-like name', `${fn.visibility} visibility`, 'no initializer, reinitializer or onlyInitializing modifier', 'no initialized-flag guard in the body'],
            remediation: chained
              ? 'Make chained initializers internal and mark them onlyInitializing.'
              : 'Use the initializer modifier or require the initialized flag to be false and set it before any external call.',
          }),
        );
      }

      const stmts = statementsOf(fn, source);
      const flagIdx = stmts.findIndex((s) => FLAG_WRITE_RE.test(s.text));
      if (flagIdx > 0) {
        const call = stmts.slice(0, flagIdx).find((s) => EXTERNAL_CALL_RE.test(s.text));
        if (call) {
          findings.push(
            makeFinding(source, call.offset, {
              ...base,
              kind: 'flag-set-after-external-call',
              severity: 'high',
              confidence: 'medium',
              message: `${fn.name}() makes an external call before it sets the initialized flag, so the callee can re-enter and initialize again.`,
              severityRationale: 'Re-entering before the flag is written repeats the privileged setup with attacker-chosen inputs.',
              confidenceEvidence: ['an external call precedes the flag write', `flag written at line ${stmts[flagIdx].line}`],
              remediation: 'Set the initialized flag first, then make external calls (checks-effects-interactions), or use the initializer modifier.',
              details: { flagLine: stmts[flagIdx].line },
            }),
          );
        }
      }
    }

    for (const c of contracts) {
      if (c.kind !== 'contract' || inherited.has(c.name)) continue;
      const own = functions.filter((f) => f.contract === c.name);
      const usesInitializer = own.find((f) => f.kind === 'function' && f.modifiers.some((m) => /^(initializer|reinitializer)$/.test(m)));
      if (!usesInitializer) continue;
      const ctor = own.find((f) => f.kind === 'constructor');
      if (ctor && /\b_disableInitializers\s*\(/.test(ctor.body)) continue;
      findings.push(
        makeFinding(source, usesInitializer.offset, {
          ruleId: RULE_ID,
          contract: c.name,
          function: usesInitializer.name,
          kind: 'missing-disable-initializers',
          severity: 'medium',
          confidence: 'medium',
          message: `${c.name} uses the initializer modifier but its constructor does not call _disableInitializers(), so the implementation contract itself can be initialized by anyone.`,
          severityRationale: 'A taken-over implementation can be used to attack proxies that delegatecall into it, but the impact depends on the proxy design.',
          confidenceEvidence: [`${usesInitializer.name}() uses initializer`, ctor ? 'the constructor has no _disableInitializers() call' : 'no constructor found'],
          remediation: 'Add `constructor() { _disableInitializers(); }` to the implementation contract.',
        }),
      );
    }
  } catch {
    diagnostics.push({ level: 'error', code: 'internal-error', message: 'Analysis stopped on unsupported input; findings may be incomplete.' });
  }

  findings.sort((a, b) => a.line - b.line || a.column - b.column || a.kind.localeCompare(b.kind));
  return { ruleId: RULE_ID, analyzed: true, findings, diagnostics };
}
