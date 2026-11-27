/**
 * GG-DATALOC-001: calldata, memory and storage aliasing mistakes.
 *
 * A `memory` local initialised from storage is a copy, a `storage` local is a
 * pointer to the same slot. Code that assumes the opposite silently loses writes
 * or reads values it already changed. The rule reports:
 *
 *   memory-copy-mutation-lost     a memory local copied from a state variable is
 *                                 modified but never written back to storage
 *   storage-alias-snapshot        a storage pointer is read, the same storage is
 *                                 then written directly, and the pointer is read
 *                                 again, so the "old" value is already the new one
 *   memory-param-mutation-lost    an internal function mutates a memory parameter
 *                                 and returns nothing, while a caller passes it a
 *                                 state variable (the callee changes a copy)
 *
 * Supported: Solidity 0.6 - 0.8.x, single file, intra-contract. Inherited state
 * variables are not resolved. See docs/rules/dataloc-aliasing.md.
 */

import {
  type Diagnostic,
  type RuleResult,
  type SecurityFinding,
  extractContracts,
  extractFunctions,
  extractMappings,
  extractStateVars,
  findMatching,
  makeFinding,
  mentions,
  prepareSource,
  splitTopLevel,
  statementsOf,
} from '../lib/solidity-lite';

export const RULE_ID = 'GG-DATALOC-001';

export const LIMITATIONS = [
  'State variables inherited from a base contract defined elsewhere are not known, so copies of them are not reported.',
  'Write-back is recognised as an assignment of the local to a statement that mentions the same state variable; helper functions are not followed.',
  'Calls are matched by function name only, so overloads can be confused.',
];

const VALUE_TYPE_RE = /^(u?int\d*|bool|address(\s+payable)?|bytes\d+)$/;
const COPY_RE = /^([A-Za-z_$][\w$.]*(?:\s*\[[^\]]*\])*)\s+memory\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\b(.*)$/s;
const POINTER_RE = /^([A-Za-z_$][\w$.]*(?:\s*\[[^\]]*\])*)\s+storage\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*\b.*)$/s;

function esc(n: string): string {
  return n.replace(/[$]/g, '\\$');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^$()|{}[\]\\]/g, '\\$&');
}

function mutatesVar(text: string, v: string): boolean {
  const e = esc(v);
  return (
    new RegExp(`(?<![\\w$.])${e}(?:\\s*\\.\\s*[\\w$]+|\\s*\\[[^\\]]*\\])+\\s*(?:=(?!=)|[-+*/%|&^]=|<<=|>>=|\\+\\+|--)`).test(text) ||
    new RegExp(`(?<![\\w$.])${e}\\s*\\.\\s*(?:push|pop)\\s*\\(`).test(text) ||
    new RegExp(`\\bdelete\\s+${e}\\b`).test(text)
  );
}

export function detectDataLocationAliasing(input: unknown): RuleResult {
  const prep = prepareSource(input);
  if (!prep.ok) return { ruleId: RULE_ID, analyzed: false, findings: [], diagnostics: prep.diagnostics };
  const { source, masked } = prep.prepared;
  const diagnostics: Diagnostic[] = [...prep.diagnostics];
  const findings: SecurityFinding[] = [];

  try {
    const contracts = extractContracts(masked, diagnostics);
    const functions = extractFunctions(masked, source, contracts, diagnostics);
    const stateByContract = new Map<string, Set<string>>();
    for (const v of extractStateVars(masked, source, contracts)) {
      if (!stateByContract.has(v.contract)) stateByContract.set(v.contract, new Set());
      stateByContract.get(v.contract)!.add(v.name);
    }
    for (const mp of extractMappings(masked, source, contracts)) {
      if (!mp.contract) continue;
      if (!stateByContract.has(mp.contract)) stateByContract.set(mp.contract, new Set());
      stateByContract.get(mp.contract)!.add(mp.name);
    }

    for (const fn of functions) {
      if (fn.kind !== 'function' || !fn.hasBody) continue;
      const state = stateByContract.get(fn.contract ?? '') ?? new Set<string>();
      const stmts = statementsOf(fn, source);
      const base = { ruleId: RULE_ID, contract: fn.contract, function: fn.name };

      stmts.forEach((st, i) => {
        const copy = COPY_RE.exec(st.text);
        if (copy && state.has(copy[3]) && !VALUE_TYPE_RE.test(copy[1].trim())) {
          const local = copy[2];
          const root = copy[3];
          const mutation = stmts.slice(i + 1).find((s) => mutatesVar(s.text, local));
          const persisted = stmts.slice(i + 1).some(
            (s) => mentions(s.text, root) && new RegExp(`=\\s*${esc(local)}\\s*$`).test(s.text),
          );
          if (mutation && !persisted) {
            findings.push(
              makeFinding(source, mutation.offset, {
                ...base,
                kind: 'memory-copy-mutation-lost',
                severity: 'medium',
                confidence: 'high',
                message: `${fn.name}() modifies ${local}, a memory copy of ${root}, and never writes it back, so the change is lost when the function returns.`,
                severityRationale: 'The state silently stays unchanged while the code and the caller assume it was updated.',
                confidenceEvidence: [`${local} is declared memory and initialised from ${root}`, `${local} is mutated`, `no statement assigns ${local} back to ${root}`],
                remediation: `Declare ${local} as storage to update in place, or assign it back to ${root} after the change.`,
                details: { local, stateVariable: root },
              }),
            );
          }
        }

        const ptr = POINTER_RE.exec(st.text);
        if (ptr) {
          const rhs = ptr[3].trim();
          const root = /^[A-Za-z_$][\w$]*/.exec(rhs)?.[0];
          if (root && state.has(root)) {
            const p = ptr[2];
            const rhsKey = rhs.replace(/\s+/g, '');
            const writeIdx = stmts.findIndex((s, j) => {
              if (j <= i) return false;
              const t = s.text.replace(/\s+/g, '');
              return new RegExp(`^${escapeRegExp(rhsKey)}(?:\\.[\\w$]+|\\[[^\\]]*\\])*(?:=(?!=)|[-+*/]=)`).test(t);
            });
            if (writeIdx !== -1) {
              const readBefore = stmts.slice(i + 1, writeIdx).some((s) => mentions(s.text, p));
              const readAfter = stmts.slice(writeIdx + 1).some((s) => mentions(s.text, p));
              if (readBefore && readAfter) {
                findings.push(
                  makeFinding(source, stmts[writeIdx].offset, {
                    ...base,
                    kind: 'storage-alias-snapshot',
                    severity: 'medium',
                    confidence: 'medium',
                    message: `${fn.name}() reads ${p} (a storage pointer to ${rhs}), writes ${rhs} directly, then reads ${p} again; the pointer already shows the new value, so it is not a snapshot.`,
                    severityRationale: 'Comparisons between the "old" and "new" value always see the same data, which can disable a check or a delta calculation.',
                    confidenceEvidence: [`${p} is a storage pointer`, `${rhs} is written after ${p} was read`, `${p} is read again afterwards`],
                    remediation: `Copy the values you need into memory or locals before the write, or declare ${p} as memory.`,
                    details: { pointer: p, target: rhs },
                  }),
                );
              }
            }
          }
        }
      });
    }

    for (const callee of functions) {
      if (callee.kind !== 'function' || !callee.hasBody) continue;
      if (callee.visibility !== 'internal' && callee.visibility !== 'private') continue;
      if (callee.returnsText.trim()) continue;
      const memParams = callee.params
        .map((p, index) => ({ p, index }))
        .filter(({ p }) => p.location === 'memory' && p.name && !VALUE_TYPE_RE.test(p.type));
      if (memParams.length === 0) continue;
      const state = stateByContract.get(callee.contract ?? '') ?? new Set<string>();
      const stmts = statementsOf(callee, source);
      const base = { ruleId: RULE_ID };

      for (const { p, index } of memParams) {
        const mutation = stmts.find((s) => mutatesVar(s.text, p.name));
        if (!mutation) continue;
        const caller = functions.find((f) => {
          if (f === callee || f.contract !== callee.contract || !f.hasBody) return false;
          const re = new RegExp(`(?<![\\w$.])${esc(callee.name)}\\s*\\(`, 'g');
          let m: RegExpExecArray | null;
          while ((m = re.exec(f.body)) !== null) {
            const open = m.index + m[0].length - 1;
            const close = findMatching(f.body, open, '(', ')');
            if (close === -1) return false;
            const arg = splitTopLevel(f.body.slice(open + 1, close))[index]?.trim() ?? '';
            const argRoot = /^[A-Za-z_$][\w$]*/.exec(arg)?.[0];
            if (argRoot && state.has(argRoot)) return true;
          }
          return false;
        });
        if (!caller) continue;
        findings.push(
          makeFinding(source, mutation.offset, {
            ...base,
            contract: callee.contract,
            function: callee.name,
            kind: 'memory-param-mutation-lost',
            severity: 'low',
            confidence: 'medium',
            message: `${callee.name}() mutates the memory parameter ${p.name} and returns nothing, while ${caller.name}() passes it a state variable; the callee changes a copy and storage is untouched.`,
            severityRationale: 'The update never reaches storage, but the effect depends on how each call site uses the function.',
            confidenceEvidence: [`${p.name} is a memory parameter that is mutated`, `${callee.name} has no return value`, `${caller.name}() passes a state variable`],
            remediation: `Declare the parameter as storage, or return the modified value and assign it back in the caller.`,
            details: { parameter: p.name, caller: caller.name },
          }),
        );
      }
    }
  } catch {
    diagnostics.push({ level: 'error', code: 'internal-error', message: 'Analysis stopped on unsupported input; findings may be incomplete.' });
  }

  findings.sort((a, b) => a.line - b.line || a.column - b.column || a.kind.localeCompare(b.kind));
  return { ruleId: RULE_ID, analyzed: true, findings, diagnostics };
}
