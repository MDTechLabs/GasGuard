/**
 * GG-TSTORE-001 — Unsafe transient storage (EIP-1153) access patterns (#1301).
 *
 * Transient storage (`tstore` / `tload`, or `transient` state variables) lives until the end of the
 * *transaction*, not the call, so a value that is set and never reset leaks into every later call
 * of the same transaction (multicall, batched calls, callbacks, account-abstraction bundles).
 * Per contract (including in-source bases and modifiers) the rule groups accesses by slot
 * (`tstore(SLOT, ...)` text, or the `transient` variable name) and reports:
 *  - `transient-value-never-reset`: a slot is set to a non-zero value and nothing in the contract
 *    ever stores zero to it. Medium when it behaves like a lock (a literal non-zero set and another
 *    function reads the slot to decide whether to revert), otherwise low;
 *  - `transient-read-never-written`: a slot is read with `tload` but never written in the contract,
 *    so it always reads zero (low; the slot may be written by delegatecalled code);
 *  - `delegatecall-shares-transient-storage`: a function that touches transient storage also
 *    performs a `delegatecall`, so the callee can read, overwrite or clear the same slots (low);
 *  - `unsupported-compiler-version`: the pragma pins a compiler older than 0.8.24 (`tstore`/`tload`)
 *    or 0.8.28 (`transient` variables), so the source cannot use transient storage (low).
 *
 * Supported: Solidity 0.8.x, single source string; slots are compared as text and helper functions
 * that wrap tstore are not followed. Malformed input returns `analyzed: false`.
 * No project scripts or configuration are executed. See docs/rules/storage-transient-access.md.
 */
import {
  Diagnostic,
  RuleResult,
  SecurityFinding,
  SolFunction,
  makeFinding,
  prepareSource,
} from '../lib/solidity-lite';
import { buildSourceModel } from '../lib/solidity-inheritance';
import { literal, yulCalls } from '../assembly/detect-unsafe-assembly';

export const RULE_ID = 'GG-TSTORE-001';

export interface TransientResult extends RuleResult {
  /** Distinct transient slots / variables seen, with how they are accessed. */
  slots: { contract: string; slot: string; sets: number; resets: number; loads: number }[];
}

interface Op {
  fn: SolFunction;
  kind: 'set' | 'reset' | 'load';
  key: string;
  offset: number;
  literalValue: boolean;
}

const ZERO_VALUE = /^(0|0x0+|false|address\s*\(\s*0\s*\)|bytes32\s*\(\s*0\s*\))$/;
const GUARD_WORDS = /\b(revert|require|iszero|eq|if)\b/;

function normalize(text: string): string {
  return text.replace(/\s+/g, '');
}

type Version = [number, number, number];

const less = (a: Version, b: Version) => (a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2]);

/** True when the pragma's upper bound keeps the compiler below `min`. */
function pragmaBelow(pragma: string, min: Version): boolean {
  const re = /(\^|~|>=|<=|<|>|=)?\s*(\d+)\.(\d+)\.(\d+)/g;
  const uppers: Version[] = []; // exclusive upper bounds
  let m: RegExpExecArray | null;
  while ((m = re.exec(pragma)) !== null) {
    const v: Version = [Number(m[2]), Number(m[3]), Number(m[4])];
    const op = m[1] ?? '=';
    if (op === '<') uppers.push(v);
    else if (op === '<=' || op === '=') uppers.push([v[0], v[1], v[2] + 1]);
    else if (op === '^') uppers.push(v[0] === 0 ? [0, v[1] + 1, 0] : [v[0] + 1, 0, 0]);
    else if (op === '~') uppers.push([v[0], v[1] + 1, 0]);
  }
  return uppers.some((u) => !less(min, u));
}

export function detectTransientStorageAccess(input: unknown): TransientResult {
  const prep = prepareSource(input);
  if (!prep.ok) return { ruleId: RULE_ID, analyzed: false, findings: [], diagnostics: prep.diagnostics, slots: [] };
  const { source, masked } = prep.prepared;
  const diagnostics: Diagnostic[] = [...prep.diagnostics];
  const src = buildSourceModel(masked, source, diagnostics);
  const pragma = /pragma\s+solidity\s+([^;]+);/.exec(masked)?.[1] ?? '';
  const findings: SecurityFinding[] = [];
  const slots: TransientResult['slots'] = [];
  let versionReported = false;

  for (const model of src.contracts.values()) {
    if (model.contract.kind !== 'contract') continue;
    const name = model.contract.name;
    const all = [...model.functions, ...model.modifiers.values()] as SolFunction[];

    // `uint256 transient locked;` state variables across the contract and its in-source bases.
    const transientVars = new Set<string>();
    for (const c of model.linearization) {
      const re = /\b(?:u?int\d*|bool|address|bytes\d*)\s+(?:(?:public|private|internal|constant|immutable)\s+)*transient\s+(?:(?:public|private|internal)\s+)*([A-Za-z_$][\w$]*)/g;
      let m: RegExpExecArray | null;
      const text = masked.slice(c.open, c.close);
      while ((m = re.exec(text)) !== null) transientVars.add(m[1]);
    }

    const ops: Op[] = [];
    const delegating: { fn: SolFunction; offset: number }[] = [];
    for (const fn of all) {
      if (!fn.hasBody) continue;
      for (const c of yulCalls(fn.body, ['tstore', 'tload'])) {
        const key = normalize(c.args[0] ?? '');
        const offset = fn.bodyOffset + c.index;
        if (c.name === 'tload') ops.push({ fn, kind: 'load', key, offset, literalValue: false });
        else {
          const value = (c.args[1] ?? '').trim();
          ops.push({ fn, kind: ZERO_VALUE.test(value) ? 'reset' : 'set', key, offset, literalValue: literal(value) !== null && literal(value) !== 0 });
        }
      }
      for (const v of transientVars) {
        const re = new RegExp(`(?<![\\w$.])${v}\\s*(=(?!=)\\s*([^;]+);)?`, 'g');
        let m: RegExpExecArray | null;
        while ((m = re.exec(fn.body)) !== null) {
          const offset = fn.bodyOffset + m.index;
          if (m[1]) {
            const value = m[2].trim();
            ops.push({ fn, kind: ZERO_VALUE.test(value) ? 'reset' : 'set', key: v, offset, literalValue: /^(true|[1-9]\w*)$/.test(value) });
          } else ops.push({ fn, kind: 'load', key: v, offset, literalValue: false });
        }
      }
      const touches = ops.some((o) => o.fn === fn);
      const dc = /\bdelegatecall\s*\(/.exec(fn.body);
      if (touches && dc) delegating.push({ fn, offset: fn.bodyOffset + dc.index });
    }
    if (ops.length === 0) continue;

    const mine = (fn: SolFunction) => fn.contract === name;
    const add = (offset: number, fn: SolFunction, f: Omit<SecurityFinding, 'ruleId' | 'line' | 'column' | 'contract' | 'function'>) =>
      findings.push(makeFinding(source, offset, { ruleId: RULE_ID, contract: name, function: fn.name, ...f }));

    const keys = [...new Set(ops.map((o) => o.key))].sort();
    for (const key of keys) {
      const forKey = ops.filter((o) => o.key === key);
      const sets = forKey.filter((o) => o.kind === 'set');
      const resets = forKey.filter((o) => o.kind === 'reset');
      const loads = forKey.filter((o) => o.kind === 'load');
      slots.push({ contract: name, slot: key, sets: sets.length, resets: resets.length, loads: loads.length });
      const isVar = transientVars.has(key);

      if (sets.length > 0 && resets.length === 0) {
        const first = sets.filter((o) => mine(o.fn)).sort((a, b) => a.offset - b.offset)[0];
        if (first) {
          const lockLike = first.literalValue && loads.some((l) => GUARD_WORDS.test(l.fn.body));
          add(first.offset, first.fn, {
            kind: 'transient-value-never-reset', severity: lockLike ? 'medium' : 'low', confidence: lockLike ? 'high' : 'medium',
            message: `Transient slot ${key} is set to a non-zero value but never reset to zero anywhere in ${name}; the value stays for the rest of the transaction.`,
            severityRationale: lockLike
              ? 'The slot acts as a lock or flag; once set, every later call in the same transaction (multicall, callback, batch) sees it still set and reverts or skips its checks; severity medium.'
              : 'A leftover value can leak into later calls in the same transaction; impact depends on how the slot is read; severity low.',
            confidenceEvidence: [`${sets.length} set(s), 0 zero-store(s), ${loads.length} read(s) of ${key}`, `kind: ${isVar ? 'transient variable' : 'tstore slot'}`, `lock-like: ${lockLike ? 'yes' : 'no'}`],
            remediation: 'Store zero to the slot when the protected section ends (including on every exit path), or use a pattern that restores the previous value.',
            details: { slot: key, sets: sets.length, resets: 0, loads: loads.length, variable: isVar },
          });
        }
      }

      if (!isVar && loads.length > 0 && sets.length === 0 && resets.length === 0) {
        const first = loads.filter((o) => mine(o.fn)).sort((a, b) => a.offset - b.offset)[0];
        if (first) {
          add(first.offset, first.fn, {
            kind: 'transient-read-never-written', severity: 'low', confidence: 'medium',
            message: `Transient slot ${key} is read with tload but never written in ${name}, so it always reads zero.`,
            severityRationale: 'The check built on the slot never fires, which usually means a missing tstore or a mismatched slot constant; severity low.',
            confidenceEvidence: [`${loads.length} tload(s) and no tstore of ${key}`, 'delegatecalled code could still write it'],
            remediation: 'Write the slot before it is read, or fix the slot constant used by tstore and tload.',
            details: { slot: key, loads: loads.length },
          });
        }
      }
    }

    for (const d of delegating.filter((x) => mine(x.fn))) {
      add(d.offset, d.fn, {
        kind: 'delegatecall-shares-transient-storage', severity: 'low', confidence: 'medium',
        message: `${d.fn.name} uses transient storage and also delegatecalls; the callee runs in this contract's transient storage and can read, overwrite or clear the same slots.`,
        severityRationale: 'A delegatecall target can defeat transient locks or flags kept by the caller; severity low because it needs a hostile or buggy target.',
        confidenceEvidence: ['delegatecall in a function that accesses transient storage'],
        remediation: 'Do not delegatecall untrusted code while a transient lock is held, or use a lock slot the target cannot know.',
        details: { function: d.fn.name },
      });
    }

    if (!versionReported && pragma) {
      const needsVar = ops.some((o) => transientVars.has(o.key));
      const min: Version = needsVar ? [0, 8, 28] : [0, 8, 24];
      if (pragmaBelow(pragma, min)) {
        versionReported = true;
        const first = [...ops].sort((a, b) => a.offset - b.offset)[0];
        add(first.offset, first.fn, {
          kind: 'unsupported-compiler-version', severity: 'low', confidence: 'high',
          message: `pragma solidity ${pragma.trim()} cannot select a compiler that supports ${needsVar ? 'transient variables (0.8.28)' : 'tstore/tload (0.8.24)'}.`,
          severityRationale: 'The source cannot be compiled as written, or was written for a different compiler than the one pinned; severity low.',
          confidenceEvidence: [`pragma: ${pragma.trim()}`, `minimum compiler: ${min.join('.')}`],
          remediation: `Raise the pragma to ${min.join('.')} or later and set evmVersion to cancun or later.`,
          details: { pragma: pragma.trim(), minimum: min.join('.') },
        });
      }
    }
  }
  return { ruleId: RULE_ID, analyzed: true, findings, diagnostics, slots };
}
