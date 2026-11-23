/**
 * GG-CALLORDER-001 — External call ordering around state changes.
 *
 * Finds public/external functions that make an external interaction and only afterwards write
 * storage that can be observed or re-entered. Unlike a plain "write after call" check, a late
 * write is reported only when it is *relevant*:
 *
 *   check-then-act     the function checked the variable before the call (`require(!claimed[x])`),
 *                      so a re-entrant call passes the same check again           → replay
 *   accounting         the variable is asset or liability state (balances, shares, debt, ...)
 *   observed           another external function in the contract, or another contract that calls
 *                      back into this one, reads or mutates the variable
 *
 * Storage writes before and after every external call are tracked across internal helpers,
 * inherited functions and non-lock modifier bodies (code before and after `_;`).
 *
 * False-positive reducers (each recorded in `details.treatedAsNonInteractive` / `confidenceEvidence`):
 *   - `address.transfer/send` (2300 gas stipend), `staticcall`, view/pure and getter calls;
 *   - calls into project contracts whose resolved implementation cannot reach an untrusted call;
 *   - targets listed in the `trustedTargets` option;
 *   - inline mutexes: a boolean written both before and after the call is a lock, not state;
 *   - the function's own reentrancy lock, which suppresses re-entry-based findings and leaves only
 *     readers that are not covered by the lock (for example an unguarded view).
 *
 * Supported: Solidity 0.6 – 0.8.x source text, one string or several `{ path, content }` sources
 * resolved by contract name; compiler settings and project configuration are never read or trusted.
 *
 * Limitations: lexical analysis; branches are flattened in source order; relevance and accounting
 * classification are name based; locks are recognized by modifier name or body; callee code behind
 * low-level calls, address-typed targets and interfaces without an implementation is not analyzed
 * (reported in `limitations` and as `unresolved-dynamic-call` diagnostics). See
 * docs/rules/solidity-call-safety.md.
 */

import { Diagnostic, RuleResult, SecurityFinding, Severity, lineColumn, statementsOf } from '../lib/solidity-lite';
import {
  AccountingKind,
  ModelFunction,
  ProjectModel,
  ProjectSource,
  Timeline,
  TimelineEvent,
  buildProjectModel,
  buildTimeline,
  findFunction,
  findModifier,
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
import { describeInteraction, isTrusted, makeReach } from './detect-cross-contract-reentrancy';

export const RULE_ID = 'GG-CALLORDER-001';

export interface CallOrderOptions {
  /** Contract or interface type names whose calls never re-enter. */
  trustedTargets?: string[];
  maxFindings?: number;
}

const LIMITATIONS = [
  'Lexical analysis of Solidity 0.6–0.8.x source; no compiler AST, remappings or import resolution. Contracts missing from the supplied sources are unresolved.',
  'Branches are flattened in source order, so a write on an alternative branch may be treated as occurring after the call.',
  'Relevance of a late write (accounting, checked before the call, read elsewhere) is inferred from names and call sites in the supplied sources.',
  'Callee code behind low-level calls, address-typed targets and interfaces without an implementation is not analyzed.',
  'Modifier bodies are modeled only when defined in the supplied sources; reentrancy-lock modifiers are recognized but not inlined.',
];

type Relevance = 'check-then-act' | 'accounting' | 'observed';

interface LateWrite {
  event: TimelineEvent;
  relevance: Relevance[];
  accounting?: AccountingKind;
  readers: string[];
}

function escapeRe(name: string): string {
  return name.replace(/[$]/g, '\\$');
}

/** Pre-/post-`_;` parts of the non-lock modifiers on `fn`, as synthetic functions. */
function modifierParts(model: ProjectModel, contract: string, fn: ModelFunction): { pre: ModelFunction[]; post: ModelFunction[] } {
  const pre: ModelFunction[] = [];
  const post: ModelFunction[] = [];
  for (const name of fn.modifiers) {
    if (hasReentrancyLock(model, contract, { ...fn, modifiers: [name] }).guarded) continue;
    const mod = findModifier(model, contract, name);
    if (!mod?.hasBody) continue;
    const placeholder = /(^|[^\w$])_\s*;/.exec(mod.body);
    if (!placeholder) {
      pre.push(mod);
      continue;
    }
    const pos = placeholder.index + placeholder[1].length;
    const end = placeholder.index + placeholder[0].length;
    pre.push({ ...mod, body: mod.body.slice(0, pos) });
    post.unshift({ ...mod, body: mod.body.slice(end), bodyOffset: mod.bodyOffset + end });
  }
  return { pre, post };
}

export function detectExternalCallOrdering(input: string | ProjectSource[], options: CallOrderOptions = {}): RuleResult {
  const built = buildProjectModel(input);
  if (!built.ok) return { ruleId: RULE_ID, analyzed: false, findings: [], diagnostics: built.diagnostics, limitations: LIMITATIONS };
  const { model } = built;
  const diagnostics: Diagnostic[] = [...model.diagnostics];
  const limitations = [...LIMITATIONS];
  const trusted = new Set(options.trustedTargets ?? []);
  const maxFindings = options.maxFindings ?? 100;
  const reaches = makeReach(model, trusted);
  const findings: SecurityFinding[] = [];
  const emitted = new Set<string>();
  if (model.truncated) limitations.push('Input bounds were hit; some files were not analyzed (see diagnostics).');

  const concrete = [...model.contracts.values()].filter((c) => c.kind === 'contract');
  for (const c of concrete) {
    const missing = unresolvedBases(model, c.name);
    if (missing.length > 0) limitations.push(`${c.name} inherits ${missing.join(', ')}, which is not in the supplied sources; inherited behavior is not analyzed.`);
  }

  const cache = new Map<string, Timeline>();
  const timelineOf = (contract: string, fn: ModelFunction): Timeline => {
    const key = `${contract}.${fn.contractName}.${fn.name}/${fn.params.length}@${fn.offset}`;
    let tl = cache.get(key);
    if (!tl) {
      tl = buildTimeline(model, contract, fn);
      cache.set(key, tl);
    }
    return tl;
  };

  const boundaries = new Set<string>();

  for (const a of concrete) {
    if (findings.length >= maxFindings) break;
    const states = stateVarsOf(model, a.name);
    const functions = functionsOf(model, a.name);

    for (const f of functions) {
      if (findings.length >= maxFindings) break;
      if (!isExternallyCallable(f) || !isStateChanging(f)) continue;

      // Full ordered timeline: modifier prefixes, the function, modifier suffixes.
      const parts = modifierParts(model, a.name, f);
      const events: TimelineEvent[] = [];
      const touched = new Set<string>();
      for (const part of [...parts.pre, f, ...parts.post]) {
        const tl = buildTimeline(model, a.name, part);
        events.push(...tl.events);
        tl.touched.forEach((t) => touched.add(t));
      }
      for (const e of events) {
        if (!e.call?.dynamic) continue;
        const key = `${e.file}:${e.line}`;
        if (boundaries.has(key) || boundaries.size >= 50) continue;
        boundaries.add(key);
        const what = e.call.class === 'low-level' ? `low-level ${e.call.method}` : `call to ${e.call.targetType ?? 'an address'}.${e.call.method}`;
        diagnostics.push({
          level: 'warning',
          code: 'unresolved-dynamic-call',
          message: `${e.file}:${e.line}: ${what} in ${a.name}.${f.name}() has a target that cannot be resolved from the supplied sources; code reachable through it is not analyzed.`,
          line: e.line,
        });
      }

      // Classify every call: reentrant interaction or provably non-interactive (with the reason).
      const nonInteractive: Array<{ expression: string; line: number; reason: string }> = [];
      const interactions: Array<{ index: number; event: TimelineEvent }> = [];
      events.forEach((e, index) => {
        const call = e.call;
        if (!call) return;
        let reason: string | undefined;
        if (call.class === 'eth-transfer') reason = 'stipend-limited transfer/send (2300 gas)';
        else if (call.class === 'static') reason = 'read-only call';
        else if (call.class === 'self') reason = 'call on this';
        else if (isTrusted(call, trusted)) reason = 'target listed in trustedTargets';
        else if (call.class === 'resolved' && call.targetContract && call.targetFunction && !reaches(call.targetContract, call.targetFunction)) {
          reason = `callee ${call.targetContract}.${call.method}() is resolved and cannot reach an untrusted call`;
        } else if (!isReentrantInteraction(call)) reason = 'not a reentrant interaction';
        if (reason) nonInteractive.push({ expression: describeInteraction(call), line: e.line, reason });
        else interactions.push({ index, event: e });
      });
      if (interactions.length === 0) continue;

      const lockF = hasReentrancyLock(model, a.name, f);
      const fileOfF = model.files.get(f.file)!;
      const fStatements = statementsOf(f, fileOfF.source);

      for (const { index, event } of interactions) {
        const after = events.slice(index + 1).filter((e) => e.kind === 'write');
        if (after.length === 0) continue;
        const before = events.slice(0, index).filter((e) => e.kind === 'write');

        // Offset (in F's own body) of the statement that starts the interaction.
        const gateOffset =
          event.via.length === 0 && event.file === f.file
            ? event.offset
            : fStatements.find((s) => new RegExp(`(^|[^\\w$.])${escapeRe(event.via[0] ?? '')}\\s*\\(`).test(s.text))?.offset ?? -1;
        const guardsBefore = fStatements.filter((s) => s.offset < gateOffset && /^(require|assert|if|revert)\b/.test(s.text));

        // A boolean written both before and after the call and checked before it is an inline mutex.
        const mutexVars = [...new Set(after.map((w) => w.variable!))].filter(
          (v) => /^bool\b/.test(states.get(v)!.valueType) && before.some((b) => b.variable === v) && guardsBefore.some((g) => new RegExp(`(^|[^\\w$.])${escapeRe(v)}(?![\\w$])`).test(g.text)),
        );
        const locked = lockF.guarded || mutexVars.length > 0;
        const lockName = lockF.modifier ?? `inline mutex ${mutexVars[0]}`;

        const late: LateWrite[] = [];
        const seen = new Set<string>();
        for (const w of after) {
          const v = w.variable!;
          if (seen.has(v)) continue;
          seen.add(v);
          if (mutexVars.includes(v)) continue;
          // Locals that carry the variable's value (`uint amt = balances[x]`) count as checks of it.
          const carriers = new Set<string>([v]);
          for (const st of fStatements) {
            if (st.offset >= gateOffset) break;
            const asg = /^(?:[A-Za-z_$][\w$.\[\]]*\s+)*([A-Za-z_$][\w$]*)\s*=(?!=)\s*([\s\S]*)$/.exec(st.text);
            if (asg && new RegExp(`(^|[^\\w$.])${escapeRe(v)}(?![\\w$])`).test(asg[2])) carriers.add(asg[1]);
          }
          const relevance: Relevance[] = [];
          const readers: string[] = [];
          if (!locked && guardsBefore.some((g) => [...carriers].some((c) => new RegExp(`(^|[^\\w$.])${escapeRe(c)}(?![\\w$])`).test(g.text)))) {
            relevance.push('check-then-act');
          }
          if (w.accounting && !locked) relevance.push('accounting');

          // Other readers: functions of this contract, and other contracts that call back into it.
          for (const r of functions) {
            if (r === f || !isExternallyCallable(r) || !timelineOf(a.name, r).touched.has(v)) continue;
            // Under a lock, same-contract views are not consumers; unlocked mutators still are.
            if (locked && !isStateChanging(r)) continue;
            const covered = locked && hasReentrancyLock(model, a.name, r).guarded;
            if (!covered) readers.push(`${a.name}.${r.name}()`);
          }
          for (const c of concrete) {
            if (c.name === a.name) continue;
            for (const h of functionsOf(model, c.name)) {
              if (!isExternallyCallable(h)) continue;
              for (const e of timelineOf(c.name, h).events) {
                const call = e.call;
                if (!call?.targetContract || !mro(model, a.name).includes(call.targetContract)) continue;
                const declared = call.targetFunction;
                const impl = declared ? findFunction(model, a.name, declared.name, declared.params.length) : undefined;
                const target = impl?.hasBody ? impl : undefined;
                const publicVar = declared && !target ? states.get(declared.name) : undefined;
                const getter = call.getterVariable ?? (publicVar?.public ? publicVar.name : undefined);
                const hit = getter ? getter === v : !!target && timelineOf(a.name, target).touched.has(v);
                if (!hit) continue;
                const covered =
                  locked && !!target && (call.class === 'static' ? hasViewLockCheck(model, a.name, target) : hasReentrancyLock(model, a.name, target).guarded);
                if (!covered) readers.push(`${c.name}.${h.name}()`);
              }
            }
          }
          const uniqueReaders = [...new Set(readers)];
          if (uniqueReaders.length > 0 && relevance.length === 0) relevance.push('observed');
          if (relevance.length > 0) late.push({ event: w, relevance, accounting: w.accounting, readers: uniqueReaders });
        }
        if (late.length === 0) continue;

        const call = event.call!;
        const lowLevel = call.class === 'low-level';
        const replay = late.some((l) => l.relevance.includes('check-then-act'));
        const accounting = late.some((l) => l.relevance.includes('accounting'));
        const kind = replay ? 'check-effects-violation' : accounting ? 'accounting-after-interaction' : 'observable-state-after-interaction';
        const order: Severity[] = ['low', 'medium', 'high', 'critical'];
        let level: number;
        if (replay) level = lowLevel ? (call.valueBearing || accounting ? 3 : 2) : 2;
        else if (accounting) level = lowLevel ? 2 : 1;
        else level = lowLevel ? 1 : 0;
        const severity = order[level];
        const confidence = lowLevel || call.class === 'resolved' ? 'high' : 'medium';

        const dedupe = `${event.file}:${event.offset}:${f.name}:${kind}`;
        if (emitted.has(dedupe)) break;
        emitted.add(dedupe);

        const file = model.files.get(event.file)!;
        const { line, column } = lineColumn(file.source, event.offset);
        const vars = late.map((l) => l.event.variable!);
        findings.push({
          ruleId: RULE_ID,
          kind,
          severity,
          confidence,
          file: event.file,
          line,
          column,
          contract: a.name,
          function: f.name,
          message:
            `${a.name}.${f.name}() calls ${describeInteraction(call)} before writing ${vars.join(', ')}. ` +
            (replay
              ? 'The function checks this state before the call, so a re-entrant call passes the same check again.'
              : accounting
                ? 'Accounting is still stale while the callee runs.'
                : `The state is read by ${late.flatMap((l) => l.readers).slice(0, 2).join(', ')} and is observable mid-update.`),
          severityRationale:
            `${lowLevel ? 'The interaction forwards control to arbitrary code' : 'The interaction target may run callback code (token hook or unresolved interface)'}` +
            `${call.valueBearing ? ' and forwards value' : ''}; ` +
            `${replay ? 'a guard that is checked before and updated after the call can be replayed' : accounting ? 'asset/liability state is updated only after control has left the function' : 'other code can observe the stale value'}.` +
            `${locked ? ` ${f.name}() holds ${lockName}, so only readers outside the lock are counted.` : ''}`,
          confidenceEvidence: [
            `interaction ${describeInteraction(call)} at ${event.file}:${line}${event.via.length ? ` (via ${event.via.join(' → ')})` : ''}`,
            `writes before the call: ${before.length ? [...new Set(before.map((b) => b.variable))].join(', ') : 'none'}`,
            ...late.map((l) => `${l.event.variable} written after the call at ${l.event.file}:${l.event.line} (${l.relevance.join(', ')}${l.readers.length ? `; read by ${l.readers.slice(0, 3).join(', ')}` : ''})`),
            ...(f.contractName !== a.name ? [`${f.name}() is inherited from ${f.contractName}`] : []),
            ...(mutexVars.length ? [`${mutexVars.join(', ')} is written before and after the call and checked first: treated as an inline mutex`] : []),
            ...nonInteractive.slice(0, 4).map((n) => `${n.expression} at line ${n.line} treated as non-interactive: ${n.reason}`),
          ],
          remediation:
            'Move every state write that other code can observe, or that the function itself checks, above the external call (checks-effects-interactions). ' +
            'If the write cannot move, hold a reentrancy lock on the function and on every function and view that reads the state.',
          details: {
            interaction: { expression: describeInteraction(call), class: call.class, valueBearing: call.valueBearing, via: event.via },
            writesBefore: before.map((b) => ({ variable: b.variable, line: b.line, file: b.file })),
            writesAfter: late.map((l) => ({ variable: l.event.variable, line: l.event.line, file: l.event.file, accounting: l.accounting, relevance: l.relevance, readers: l.readers })),
            treatedAsNonInteractive: nonInteractive,
            lock: { ...lockF, inlineMutex: mutexVars[0] },
            allInteractions: interactions.map((i) => ({ expression: describeInteraction(i.event.call!), line: i.event.line })),
          },
        });
        break;
      }
    }
  }
  if (boundaries.size > 0) {
    limitations.push(`${boundaries.size} unresolved dynamic-call boundar${boundaries.size === 1 ? 'y' : 'ies'} (low-level calls or targets outside the supplied sources); callees behind them are not analyzed.`);
  }
  return { ruleId: RULE_ID, analyzed: true, findings, diagnostics, limitations };
}
