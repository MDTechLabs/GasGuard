/**
 * GG-REENTRANCY-XCONTRACT-001 — Cross-contract reentrancy through shared accounting state.
 *
 * A function that hands control to an untrusted callee (ETH `call`, token hooks, an unresolved
 * interface) before it finishes updating its accounting leaves a window in which the callee can
 * call into a *different* contract that reads or mutates that same accounting. A reentrancy
 * guard on the first contract does not help when the second contract only reads the first one's
 * state through a view function (read-only reentrancy) or reaches an unguarded mutator.
 *
 * For every state-changing public/external function F of every contract A the rule:
 *   1. builds F's ordered timeline of storage writes and external calls, following internal
 *      helpers and inherited functions;
 *   2. finds the first reentrant interaction that is followed by a write to asset or liability
 *      state (balances, shares, debt, reserves, ...), i.e. a checks-effects-interactions break;
 *   3. looks in every other project contract C for public/external functions H that call back into
 *      A (typed state variable, cast, parameter or local) and touch one of the not-yet-updated
 *      variables, either by reading it (`stale-read`) or through a mutator (`shared-mutation`);
 *   4. discards the pair when A's own lock demonstrably covers the path (F holds a lock and the
 *      callee is a locked mutator, or a view that refuses to answer while the lock is held).
 *
 * Supported: Solidity 0.6 – 0.8.x source text, one string or several `{ path, content }` sources
 * resolved by contract name. Compiler settings are never consulted; no project script or
 * configuration is executed or trusted.
 *
 * Analysis limitations (also emitted on every result):
 *  - Lexical analysis, no compiler AST, no remappings or import resolution: contracts missing
 *    from the supplied sources are unresolved boundaries.
 *  - Branches are flattened in source order; a write on a different branch than the call can be
 *    reported as "after" it.
 *  - Accounting state is recognized by identifier names; shared state means state reachable
 *    through a resolved call into another contract, not storage aliasing via delegatecall/proxies.
 *  - Low-level calls, delegatecall and calls on address-typed or out-of-project targets are
 *    unresolved dynamic-call boundaries; they are listed in `limitations` and as
 *    `unresolved-dynamic-call` diagnostics.
 *  - Internal helper inlining is bounded (depth 4); locks are recognized by modifier name or body.
 * See docs/rules/solidity-call-safety.md.
 */

import {
  Diagnostic,
  RuleResult,
  SecurityFinding,
  Severity,
  lineColumn,
} from '../lib/solidity-lite';
import {
  CallSite,
  ModelFunction,
  ProjectModel,
  ProjectSource,
  Timeline,
  TimelineEvent,
  buildProjectModel,
  buildTimeline,
  findFunction,
  functionsOf,
  hasReentrancyLock,
  hasViewLockCheck,
  isExternallyCallable,
  isReentrantInteraction,
  isStateChanging,
  mro,
  stateVarsOf,
  unresolvedBases,
} from '../lib/project-model';

export const RULE_ID = 'GG-REENTRANCY-XCONTRACT-001';

export interface CrossContractReentrancyOptions {
  /** Contract or interface type names whose calls are never treated as untrusted interactions. */
  trustedTargets?: string[];
  /** Maximum number of findings returned. */
  maxFindings?: number;
  /** Maximum number of re-entry surfaces listed per finding. */
  maxSurfaces?: number;
}

const BASE_LIMITATIONS = [
  'Lexical analysis of Solidity 0.6–0.8.x source; no compiler AST, remappings or import resolution. Contracts missing from the supplied sources are unresolved.',
  'Branches are flattened in source order, so a write on an alternative branch may be treated as occurring after an external call.',
  'Accounting (asset/liability) state is recognized by identifier names; proxy/delegatecall storage sharing is not modeled.',
  'Reentrancy locks are recognized by modifier name or by a project modifier that references a lock variable; lock state shared through another contract is not modeled.',
  'Internal helper inlining is bounded to depth 4 and the number of files, characters and timeline events is capped.',
];

interface Surface {
  contract: string;
  function: string;
  file: string;
  line: number;
  mode: 'stale-read' | 'shared-mutation';
  via: string;
  touches: string[];
  acts: boolean;
}

/** Does function F of `contract` reach a reentrant interaction (used to decide if a project call can call back out)? */
export function makeReach(model: ProjectModel, trusted: Set<string>) {
  const memo = new Map<string, boolean>();
  const reach = (contract: string, fn: ModelFunction, seen: Set<string>): boolean => {
    const key = `${contract}.${fn.name}/${fn.params.length}`;
    if (memo.has(key)) return memo.get(key)!;
    if (seen.has(key)) return false;
    seen.add(key);
    let result = false;
    for (const e of buildTimeline(model, contract, fn).events) {
      const c = e.call;
      if (!c || !isReentrantInteraction(c) || isTrusted(c, trusted)) continue;
      if (c.class === 'resolved' && c.targetContract && c.targetFunction) {
        if (reach(c.targetContract, c.targetFunction, seen)) result = true;
      } else {
        result = true;
      }
      if (result) break;
    }
    seen.delete(key);
    memo.set(key, result);
    return result;
  };
  return (contract: string, fn: ModelFunction) => reach(contract, fn, new Set());
}

export function isTrusted(call: CallSite, trusted: Set<string>): boolean {
  return (!!call.targetType && trusted.has(call.targetType)) || (!!call.targetContract && trusted.has(call.targetContract));
}

export function describeInteraction(call: CallSite): string {
  if (call.class === 'low-level') return `${call.receiver}.${call.method}(...)${call.delegate ? ' (delegatecall)' : ''}`;
  return `${call.receiver}.${call.method}(...)`;
}

export function detectCrossContractReentrancy(
  input: string | ProjectSource[],
  options: CrossContractReentrancyOptions = {},
): RuleResult {
  const built = buildProjectModel(input);
  if (!built.ok) return { ruleId: RULE_ID, analyzed: false, findings: [], diagnostics: built.diagnostics, limitations: BASE_LIMITATIONS };
  const { model } = built;
  const diagnostics: Diagnostic[] = [...model.diagnostics];
  const limitations = [...BASE_LIMITATIONS];
  const trusted = new Set(options.trustedTargets ?? []);
  const maxFindings = options.maxFindings ?? 100;
  const maxSurfaces = options.maxSurfaces ?? 5;
  const reaches = makeReach(model, trusted);
  const findings: SecurityFinding[] = [];
  const emitted = new Set<string>();

  if (model.truncated) limitations.push('Input bounds were hit; some files were not analyzed (see diagnostics).');

  const concrete = [...model.contracts.values()].filter((c) => c.kind === 'contract');
  for (const c of concrete) {
    const missing = unresolvedBases(model, c.name);
    if (missing.length > 0) {
      limitations.push(`${c.name} inherits ${missing.join(', ')}, which is not in the supplied sources; inherited behavior is not analyzed.`);
    }
  }

  // Timelines are computed once per (contract, function).
  const timelines = new Map<string, Timeline>();
  const timelineOf = (contract: string, fn: ModelFunction): Timeline => {
    const key = `${contract}.${fn.contractName}.${fn.name}/${fn.params.length}@${fn.offset}`;
    let tl = timelines.get(key);
    if (!tl) {
      tl = buildTimeline(model, contract, fn);
      timelines.set(key, tl);
    }
    return tl;
  };

  // Unresolved dynamic-call boundaries across the whole project, reported once per location.
  const boundaries = new Set<string>();
  for (const c of concrete) {
    for (const fn of functionsOf(model, c.name)) {
      if (fn.kind !== 'function' || !fn.hasBody) continue;
      for (const e of timelineOf(c.name, fn).events) {
        if (!e.call?.dynamic) continue;
        const key = `${e.file}:${e.line}`;
        if (boundaries.has(key) || boundaries.size >= 50) continue;
        boundaries.add(key);
        const what = e.call.class === 'low-level' ? `low-level ${e.call.method}` : `call to ${e.call.targetType ?? 'an address'}.${e.call.method}`;
        diagnostics.push({
          level: 'warning',
          code: 'unresolved-dynamic-call',
          message: `${e.file}:${e.line}: ${what} in ${c.name}.${fn.name}() has a target that cannot be resolved from the supplied sources; code reachable through it is not analyzed.`,
          line: e.line,
        });
      }
    }
  }
  if (boundaries.size > 0) {
    limitations.push(`${boundaries.size} unresolved dynamic-call boundar${boundaries.size === 1 ? 'y' : 'ies'} (low-level calls or targets outside the supplied sources); callees behind them are not analyzed.`);
  }

  for (const a of concrete) {
    if (findings.length >= maxFindings) break;
    for (const f of functionsOf(model, a.name)) {
      if (findings.length >= maxFindings) break;
      if (!isExternallyCallable(f) || !isStateChanging(f)) continue;
      const tl = timelineOf(a.name, f);
      const lockF = hasReentrancyLock(model, a.name, f);

      // First reentrant interaction that is followed by an accounting write.
      let found: { index: number; event: TimelineEvent; pending: TimelineEvent[] } | undefined;
      for (let i = 0; i < tl.events.length && !found; i++) {
        const e = tl.events[i];
        const call = e.call;
        if (!call || !isReentrantInteraction(call) || isTrusted(call, trusted)) continue;
        if (call.class === 'resolved' && call.targetContract && call.targetFunction && !reaches(call.targetContract, call.targetFunction)) continue;
        const pending = tl.events.slice(i + 1).filter((w) => w.kind === 'write' && w.accounting);
        if (pending.length > 0) found = { index: i, event: e, pending };
      }
      if (!found) continue;

      const pendingVars = [...new Set(found.pending.map((w) => w.variable!))];
      const surfaces: Surface[] = [];
      let protectedCount = 0;
      for (const c of concrete) {
        if (c.name === a.name) continue;
        for (const h of functionsOf(model, c.name)) {
          if (!isExternallyCallable(h)) continue;
          const htl = timelineOf(c.name, h);
          for (let k = 0; k < htl.events.length; k++) {
            const call = htl.events[k].call;
            if (!call?.targetContract || !mro(model, a.name).includes(call.targetContract)) continue;
            // Interface-typed callees resolve to A's implementation (or to a public state getter).
            const declared = call.targetFunction;
            const impl = declared ? findFunction(model, a.name, declared.name, declared.params.length) : undefined;
            const target = impl?.hasBody ? impl : undefined;
            const publicVar = declared && !target ? stateVarsOf(model, a.name).get(declared.name) : undefined;
            const getter = call.getterVariable ?? (publicVar?.public ? publicVar.name : undefined);
            const touches = getter
              ? pendingVars.filter((v) => v === getter)
              : target
                ? pendingVars.filter((v) => timelineOf(a.name, target).touched.has(v))
                : [];
            if (touches.length === 0) continue;
            const mode: Surface['mode'] = call.class === 'static' ? 'stale-read' : 'shared-mutation';
            const acts = isStateChanging(h) && (htl.events.length > k + 1 || !!call.valueBearing);
            if (mode === 'stale-read' && !acts) continue;
            const covered =
              lockF.guarded &&
              ((mode === 'shared-mutation' && !!target && hasReentrancyLock(model, a.name, target).guarded) ||
                (mode === 'stale-read' && !!target && hasViewLockCheck(model, a.name, target)));
            if (covered) {
              protectedCount++;
              continue;
            }
            if (surfaces.some((s) => s.contract === c.name && s.function === h.name && s.mode === mode)) continue;
            surfaces.push({
              contract: c.name,
              function: h.name,
              file: h.file,
              line: h.line,
              mode,
              via: getter ? `${call.receiver}.${call.method}()` : `${call.receiver}.${call.method}(...)`,
              touches,
              acts,
            });
          }
        }
      }
      if (surfaces.length === 0) continue;

      const top = surfaces.slice(0, maxSurfaces);
      const first = top[0];
      const interaction = found.event.call!;
      const staleRead = top.some((s) => s.mode === 'stale-read');
      const valueMove = top.some((s) => {
        const h = findFunction(model, s.contract, s.function);
        return !!h && timelineOf(s.contract, h).events.some((e) => e.call?.valueBearing);
      });
      const ethCall = interaction.class === 'low-level' && interaction.valueBearing;
      const severity: Severity = valueMove && (ethCall || interaction.class === 'low-level') ? 'critical' : ethCall || valueMove ? 'high' : 'medium';
      const confidence = interaction.class === 'low-level' || interaction.class === 'resolved' ? 'high' : 'medium';
      const file = model.files.get(found.event.file)!;
      const { line, column } = lineColumn(file.source, found.event.offset);
      const kind = staleRead ? 'cross-contract-stale-read' : 'cross-contract-shared-mutation';
      const liabilities = found.pending.filter((w) => w.accounting === 'liability').map((w) => w.variable!);
      const assets = found.pending.filter((w) => w.accounting === 'asset').map((w) => w.variable!);

      const dedupe = `${found.event.file}:${found.event.offset}:${f.name}:${kind}`;
      if (emitted.has(dedupe)) continue;
      emitted.add(dedupe);
      findings.push({
        ruleId: RULE_ID,
        kind,
        severity,
        confidence,
        file: found.event.file,
        line,
        column,
        contract: a.name,
        function: f.name,
        message:
          `${a.name}.${f.name}() calls ${describeInteraction(interaction)} before updating ${pendingVars.join(', ')}. ` +
          `During that call ${first.contract}.${first.function}() can ${first.mode === 'stale-read' ? 'read' : 'mutate'} the not-yet-updated state through ${first.via}` +
          `${first.mode === 'stale-read' ? ' and act on a stale value' : ' while this function is mid-update'}.`,
        severityRationale:
          `${valueMove ? 'The re-entered function moves value or credits balances using the stale state. ' : ''}` +
          `${ethCall ? 'The interaction forwards ETH with all remaining gas, so the callee can run arbitrary code. ' : interaction.class === 'low-level' ? 'The low-level call forwards control to arbitrary code. ' : 'The interaction target is not a known non-reentrant contract (token hook or unresolved interface). '}` +
          `The pending writes touch ${[...liabilities.map((v) => `liability ${v}`), ...assets.map((v) => `asset ${v}`)].join(', ') || 'accounting state'}.`,
        confidenceEvidence: [
          `interaction ${describeInteraction(interaction)} at ${found.event.file}:${line}${found.event.via.length ? ` (via ${found.event.via.join(' → ')})` : ''}`,
          ...found.pending.slice(0, 4).map((w) => `${w.variable} (${w.accounting}) written after the call at ${w.file}:${w.line}`),
          ...top.map((s) => `${s.contract}.${s.function}() reaches ${a.name} through ${s.via} (${s.mode}) at ${s.file}:${s.line}`),
          lockF.guarded ? `${f.name}() holds lock ${lockF.modifier}, but it does not cover the reached ${staleRead ? 'view' : 'mutator'}` : `${f.name}() holds no reentrancy lock`,
          protectedCount > 0 ? `${protectedCount} other path(s) are covered by the lock and were excluded` : 'no lock covers the reached path',
        ],
        remediation:
          'Apply checks-effects-interactions: update every balance, share and debt variable before the external call. ' +
          (staleRead
            ? 'For read-only reentrancy, also make the exposed view functions revert while the lock is held (for example a nonReentrantView check) or have consumers read from a snapshot.'
            : 'Guard the mutators other contracts can reach with the same lock, or route them through a single entry point that holds it.'),
        details: {
          interaction: { expression: describeInteraction(interaction), class: interaction.class, valueBearing: interaction.valueBearing, via: found.event.via },
          pendingWrites: found.pending.map((w) => ({ variable: w.variable, accounting: w.accounting, line: w.line, file: w.file })),
          sharedState: { assets, liabilities },
          reentryPath: top.map((s) => `attacker → ${s.contract}.${s.function}() → ${a.name} (${s.touches.join(', ')})`),
          surfaces: top,
          lock: lockF,
          interactionOrdering: found.index,
        },
      });
    }
  }
  return { ruleId: RULE_ID, analyzed: true, findings, diagnostics, limitations };
}
