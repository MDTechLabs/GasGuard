/**
 * GG-ACCESS-SETTER-001 — Emergency/configuration setters without an effective authorization boundary.
 *
 * Finds externally callable functions that change pause state, fees, limits, destinations
 * (treasury / recipient) or trusted integrations (oracle, router, bridge, whitelist, operator ...)
 * and checks who may call them. An authorization boundary is effective when it is one of:
 *  - a modifier whose body compares `msg.sender` with a non-parameter value, checks a role / owner,
 *    or checks a `mapping[msg.sender]` allow-list - resolved through inherited and overridden
 *    modifiers (an override with an empty body removes the check);
 *  - an access-looking modifier (`onlyOwner`, `onlyRole(..)`, `auth` ...) whose body is not in this
 *    source (e.g. imported `Ownable`) - accepted by name;
 *  - an inline check, or a call to an internal helper (`_checkAdmin()`) whose body performs one;
 *  - the same boundary on an internal setter the entry point calls.
 * Not effective: `tx.origin` comparisons and comparing `msg.sender` with a function parameter.
 *
 * Handled separately: public `view`/`pure` functions are listed as `read-only`; per-caller settings
 * (`x[msg.sender] = ..`) and intentionally permissionless controls (option `permissionlessFunctions`
 * or a `// gasguard-permissionless: <reason>` / `@custom:permissionless` comment above the function)
 * are listed as `permissionless` and never reported.
 *
 * Supported: Solidity 0.6 - 0.8.x, single source string; bases not defined in the source are visible
 * by name only. Setters are recognised by name verbs or by plain assignment of a parameter to a
 * sensitive state variable. No project scripts or configuration are executed.
 * See docs/rules/emergency-setter-access-control.md.
 */
import {
  Diagnostic,
  RuleResult,
  SecurityFinding,
  SolFunction,
  makeFinding,
  msgSenderComparands,
  prepareSource,
  statementsOf,
} from '../lib/solidity-lite';
import { buildSourceModel, calleesOf, leadingComment } from '../lib/solidity-inheritance';

export const RULE_ID = 'GG-ACCESS-SETTER-001';

export type SetterCategory = 'pause' | 'destination' | 'integration' | 'fee' | 'limit';

export interface SetterAccessOptions {
  /** Function names that are intentionally callable by anyone. */
  permissionlessFunctions?: string[];
  /** Extra modifier names accepted as authorization. */
  accessModifiers?: string[];
}

export interface SetterInventoryEntry {
  contract: string;
  function: string;
  line: number;
  category: SetterCategory;
  status: 'restricted' | 'unrestricted' | 'ineffective' | 'permissionless' | 'read-only';
  guard?: string;
}

export interface SetterAccessResult extends RuleResult {
  inventory: SetterInventoryEntry[];
}

const CATEGORIES: [SetterCategory, RegExp][] = [
  ['pause', /^(?:_?(?:is)?paused|_?stopped|_?frozen|_?halted|emergencyStop\w*|circuitBreaker\w*|killSwitch\w*)$/i],
  ['destination', /(treasury|recipient|receiver|beneficiary|feeTo|collector|destination|wallet|payee|^_?vault$)/i],
  ['integration', /(oracle|router|bridge|endpoint|adapter|relayer|trusted|whitelist|allowlist|verifier|implementation|guardian|operator|minter|keeper|gateway|factory|registry|manager)/i],
  ['fee', /(fee|rate|bps|tax|commission|royalt|spread|slippage|penalt)/i],
  ['limit', /(limit|^_?cap|cap$|^_?max|^_?min|threshold|quota|ceiling)/i],
];
const SETTER_VERB = /^(?:set|update|change|configure|enable|disable|add|remove|register|whitelist|blacklist|pause|unpause|toggle|activate|deactivate|replace|revoke|grant|allow|disallow|ban|unban|freeze|unfreeze|stop|resume|emergency|authorize|trust|untrust)/i;
const ACCESS_MOD = /^(?:only[A-Z]\w*|auth|requiresAuth|restricted|isOwner|onlyRole)$/;
const NOT_ACCESS_MOD = /^(?:onlyInitializing|onlyProxy|onlyDelegateCall)$/;
const ROLE_CALL = /\b(?:hasRole|_checkRole|_checkOwner|_checkAuthorized|isAuthorized|canCall|_authorizeCaller|_requireAuth)\s*\(/;
const ALLOW_LIST = /\b(?:require|if)\s*\(\s*!?\s*([A-Za-z_$][\w$]*)\s*\[\s*msg\.sender\s*\]/;
const ASSIGN = /^\s*([A-Za-z_$][\w$]*)((?:\s*\[[^\]]*\])*)(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*([-+*/|&^]|<<|>>)?=(?!=)\s*([\s\S]*)$/;
const PAUSE_CALL = /(?<![\w$.])_?(?:un)?pause\s*\(\s*\)/;

interface Access {
  effective: string | null;
  weak: string | null;
}

/** Looks for authorization in a block of code. `params` are the names that are caller-controlled. */
function senderCheck(code: string, params: Set<string>): Access {
  const text = code.replace(/_msgSender\s*\(\s*\)/g, 'msg.sender');
  const guarded = /\b(?:require|revert|if|assert)\b/.test(text);
  let weak: string | null = null;
  if (/tx\.origin\s*[!=]=|[!=]=\s*tx\.origin/.test(text) && !/msg\.sender\s*==\s*tx\.origin|tx\.origin\s*==\s*msg\.sender/.test(text)) weak = 'tx.origin comparison';
  if (ROLE_CALL.test(text)) return { effective: 'role or owner check', weak };
  const al = ALLOW_LIST.exec(text);
  if (al) return { effective: `${al[1]}[msg.sender] allow-list`, weak };
  if (guarded) {
    for (const c of msgSenderComparands(text)) {
      if (c === 'tx.origin') continue;
      if (params.has(c)) weak = weak ?? `msg.sender compared with parameter ${c}`;
      else return { effective: `msg.sender == ${c}`, weak };
    }
  }
  return { effective: null, weak };
}

export function detectMissingSetterAccessControl(input: unknown, options: SetterAccessOptions = {}): SetterAccessResult {
  const prep = prepareSource(input);
  if (!prep.ok) return { ruleId: RULE_ID, analyzed: false, findings: [], diagnostics: prep.diagnostics, inventory: [] };
  const { source, masked } = prep.prepared;
  const diagnostics: Diagnostic[] = [...prep.diagnostics];
  const validNames = (list: unknown, label: string): string[] => {
    if (list === undefined) return [];
    if (!Array.isArray(list) || list.some((n) => typeof n !== 'string' || !/^[A-Za-z_$][\w$]*$/.test(n))) {
      diagnostics.push({ level: 'warning', code: 'invalid-option', message: `Ignored invalid ${label} list.` });
      return [];
    }
    return list as string[];
  };
  const permissionless = new Set(validNames(options.permissionlessFunctions, 'permissionlessFunctions'));
  const extraAccess = new Set(validNames(options.accessModifiers, 'accessModifiers'));

  const src = buildSourceModel(masked, source, diagnostics);
  const findings: SecurityFinding[] = [];
  const inventory: SetterInventoryEntry[] = [];
  const seen = new Set<number>();

  const classify = (name: string): SetterCategory | undefined => CATEGORIES.find(([, re]) => re.test(name))?.[0];

  for (const model of src.contracts.values()) {
    if (!model.isLeaf || model.contract.kind !== 'contract') continue;
    const stateNames = new Set(model.stateVars.map((v) => v.name));

    /** Sensitive writes in `fn`'s own body: [category, root, line, plainFromParam]. */
    const writesOf = (fn: SolFunction) => {
      const params = new Set(fn.params.map((p) => p.name).filter(Boolean));
      const out: { category: SetterCategory; root: string; line: number; fromParam: boolean }[] = [];
      for (const st of statementsOf(fn, source)) {
        if (PAUSE_CALL.test(st.text) && !ASSIGN.test(st.text)) out.push({ category: 'pause', root: 'pause()', line: st.line, fromParam: true });
        const m = ASSIGN.exec(st.text);
        if (!m || !stateNames.has(m[1])) continue;
        if (/\[\s*(?:msg\.sender|_msgSender\s*\(\s*\))\s*\]/.test(m[2])) continue; // per-caller setting
        const category = classify(m[1]);
        if (!category) continue;
        const rhs = m[4];
        const fromParam = !m[3] && (/^(?:true|false)$/.test(rhs.trim()) || [...params].some((p) => new RegExp(`(?<![\\w$.])${p.replace(/\$/g, '\\$')}(?![\\w$])`).test(rhs)));
        out.push({ category, root: m[1], line: st.line, fromParam });
      }
      return out;
    };

    const accessOf = (fn: SolFunction, depth = 0, stack: SolFunction[] = []): Access & { via?: string } => {
      const params = new Set(fn.params.map((p) => p.name).filter(Boolean));
      let weak: string | null = null;
      for (const m of fn.modifiers) {
        if (NOT_ACCESS_MOD.test(m)) continue;
        const body = model.modifiers.get(m);
        if (body) {
          const r = senderCheck(body.body, new Set());
          if (r.effective) return { effective: `modifier ${m}`, weak: null };
          if (r.weak) weak = weak ?? `modifier ${m}: ${r.weak}`;
          // A modifier that only calls an internal helper.
          for (const h of calleesOf(model, body)) if (depth < 3 && !stack.includes(h) && accessOf(h, depth + 1, [...stack, fn]).effective) return { effective: `modifier ${m} via ${h.name}()`, weak: null };
        } else if (ACCESS_MOD.test(m) || extraAccess.has(m)) {
          return { effective: `modifier ${m} (body not visible)`, weak: null };
        }
      }
      const inline = senderCheck(fn.body, params);
      if (inline.effective) return { effective: inline.effective, weak: null };
      weak = weak ?? inline.weak;
      if (depth < 3) {
        for (const h of calleesOf(model, fn)) {
          if (stack.includes(h) || h === fn) continue;
          // Only helpers that perform the check count; a callee that merely forwards to a setter does not.
          if (senderCheck(h.body, new Set(h.params.map((p) => p.name))).effective || h.modifiers.some((m) => ACCESS_MOD.test(m))) {
            return { effective: `helper ${h.name}()`, weak: null };
          }
        }
      }
      return { effective: null, weak };
    };

    // Sensitive writes reachable from fn, following internal calls.
    const reach = (fn: SolFunction, depth = 0, stack: SolFunction[] = []): { w: ReturnType<typeof writesOf>[number]; via: SolFunction[] } | null => {
      const own = writesOf(fn);
      const first = own.find((w) => w.fromParam) ?? own[0];
      if (first) return { w: first, via: [fn] };
      if (depth >= 3) return null;
      for (const c of calleesOf(model, fn)) {
        if (stack.includes(c)) continue;
        const r = reach(c, depth + 1, [...stack, fn]);
        if (r) return { w: r.w, via: [fn, ...r.via] };
      }
      return null;
    };

    for (const fn of model.functions) {
      if (fn.kind !== 'function' || (fn.visibility !== 'public' && fn.visibility !== 'external')) continue;
      if (/^(?:initialize|init|__\w+_init\w*)$/.test(fn.name)) continue; // initializer protection is a separate rule
      if (fn.mutability === 'view' || fn.mutability === 'pure') {
        const c = classify(fn.name.replace(/^(?:get|is|view)/, '').replace(/^./, (x) => x.toLowerCase()));
        if (c && /^(?:set|update|change)/i.test(fn.name)) inventory.push({ contract: model.contract.name, function: fn.name, line: fn.line, category: c, status: 'read-only' });
        continue;
      }
      if (seen.has(fn.offset)) continue;
      const r = reach(fn);
      if (!r) continue;
      const direct = writesOf(fn);
      if (!SETTER_VERB.test(fn.name) && !(r.w.fromParam && r.via.length === 1 && direct.length > 0)) continue;
      seen.add(fn.offset);
      const base = { contract: model.contract.name, function: fn.name, line: fn.line, category: r.w.category };
      const note = leadingComment(source, fn.offset);
      if (permissionless.has(fn.name) || /gasguard-permissionless|@custom:permissionless/i.test(note)) {
        inventory.push({ ...base, status: 'permissionless' });
        continue;
      }
      const access = accessOf(fn);
      if (access.effective) {
        inventory.push({ ...base, status: 'restricted', guard: access.effective });
        continue;
      }
      const ineffective = !!access.weak;
      inventory.push({ ...base, status: ineffective ? 'ineffective' : 'unrestricted', guard: access.weak ?? undefined });
      const severity: SecurityFinding['severity'] = r.w.category === 'fee' || r.w.category === 'limit' ? 'high' : 'critical';
      const chain = r.via.length > 1 ? ` through ${r.via.slice(1).map((f) => f.name + '()').join(' -> ')}` : '';
      findings.push(
        makeFinding(source, fn.offset, {
          ruleId: RULE_ID,
          kind: ineffective ? 'ineffective-access-control' : 'unrestricted-config-setter',
          severity,
          confidence: ineffective || r.via.length > 1 ? 'medium' : 'high',
          contract: fn.contract ?? model.contract.name,
          function: fn.name,
          message: `${fn.name}() changes ${r.w.category} configuration (${r.w.root})${chain} but ${ineffective ? `its access check is not effective (${access.weak})` : 'has no access control'}.`,
          severityRationale:
            severity === 'critical'
              ? `Any caller can ${r.w.category === 'pause' ? 'pause or unpause the protocol' : r.w.category === 'destination' ? 'redirect funds to their own address' : 'swap in a trusted integration they control'}; severity critical.`
              : `Any caller can change ${r.w.category} parameters and extract value or block users; severity high.`,
          confidenceEvidence: [
            `write to ${r.w.root} at line ${r.w.line}`,
            ...(access.weak ? [access.weak] : [`no modifier, inline check or helper with a msg.sender / role check on ${fn.name}()`]),
            ...(r.via.length > 1 ? ['write reached through an internal call, so confidence is medium'] : []),
            ...(model.unresolvedBases.length ? [`bases not visible: ${model.unresolvedBases.join(', ')}`] : []),
          ],
          remediation: `Restrict ${fn.name}() to an owner or role (onlyOwner / onlyRole) and compare msg.sender, not tx.origin or a parameter. If it must stay open, document it with "// gasguard-permissionless: <reason>".`,
          details: { category: r.w.category, stateVariable: r.w.root, path: r.via.map((f) => `${f.name}:${f.line}`), weakCheck: access.weak },
        }),
      );
    }
  }
  return { ruleId: RULE_ID, analyzed: true, findings, diagnostics, inventory };
}
