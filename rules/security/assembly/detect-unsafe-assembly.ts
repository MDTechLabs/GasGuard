/**
 * GG-ASM-MEM-001 — Unsafe memory and storage operations in inline assembly (#1300).
 *
 * Every `assembly { ... }` block is scanned (Yul calls are read lexically from masked source):
 *  - `free-pointer-corruption`: `mstore(0x40, <literal below 0x80>)` points the free memory pointer
 *    into the scratch / reserved area, so the next Solidity allocation overwrites live data;
 *  - `zero-slot-overwrite`: `mstore(0x60, <non-zero>)` breaks the zero slot that Solidity uses as the
 *    initial value of empty dynamic memory arrays, unless the block restores it with `mstore(0x60, 0)`;
 *  - `unallocated-memory-write`: data written (mstore / *copy) at the free memory pointer
 *    (`mload(0x40)` or a local read from it) while the block never advances the pointer, so later
 *    allocations reuse the same bytes; blocks that end in `return` / `revert` are exempt;
 *  - `memory-safe-violation`: a block annotated `("memory-safe")` writes to a fixed offset outside the
 *    scratch space (0x00-0x3f) — the annotation lets the optimizer move memory, so the promise is false;
 *  - `fixed-storage-slot-write`: `sstore(<small literal>, v)` overlaps the slots Solidity assigns to
 *    state variables (large literals, `x.slot`, constants and keccak-derived slots are namespaced and accepted);
 *  - `user-controlled-storage-slot`: `sstore(slot, v)` where the slot derives from a function parameter or
 *    calldata without hashing it into a namespace, so a caller can write any storage slot.
 *
 * Supported: Solidity 0.6 - 0.8.x, single source string; Yul is analyzed lexically (no control-flow
 * graph), user-defined Yul functions are not followed. Malformed input returns `analyzed: false`.
 * No project scripts or configuration are executed. See docs/rules/asm-unsafe-memory-storage.md.
 */
import {
  Diagnostic,
  RuleResult,
  SecurityFinding,
  SolFunction,
  findMatching,
  makeFinding,
  prepareSource,
  splitTopLevel,
} from '../lib/solidity-lite';
import { buildSourceModel } from '../lib/solidity-inheritance';

export const RULE_ID = 'GG-ASM-MEM-001';

export interface AssemblyResult extends RuleResult {
  /** Number of assembly blocks inspected. */
  blocks: number;
}

export interface YulCall {
  name: string;
  args: string[];
  index: number;
}

const MEMORY_WRITES = new Set(['mstore', 'mstore8', 'calldatacopy', 'codecopy', 'returndatacopy', 'extcodecopy', 'mcopy']);

export function yulCalls(text: string, names: string[]): YulCall[] {
  const out: YulCall[] = [];
  const re = new RegExp(`(?<![\\w$.])(${names.join('|')})\\s*\\(`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = findMatching(text, open, '(', ')');
    if (close === -1) continue;
    out.push({ name: m[1], args: splitTopLevel(text.slice(open + 1, close)).map((a) => a.trim()), index: m.index });
  }
  return out;
}

export function literal(expr: string): number | null {
  const e = expr.trim();
  if (/^0x[0-9a-f]+$/i.test(e)) return e.length > 14 ? Number.MAX_SAFE_INTEGER : parseInt(e, 16);
  if (/^\d+$/.test(e)) return e.length > 15 ? Number.MAX_SAFE_INTEGER : Number(e);
  return null;
}

const isFreePointerRead = (expr: string) => /^mload\s*\(\s*(0x40|64|0x0*40)\s*\)$/i.test(expr.trim());

function assemblyBlocks(body: string): { start: number; open: number; end: number }[] {
  const out: { start: number; open: number; end: number }[] = [];
  const re = /\bassembly\s*(?:"[^"]*"\s*)?(?:\([^)]*\)\s*)?\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const open = m.index + m[0].length - 1;
    const end = findMatching(body, open);
    if (end === -1) continue;
    out.push({ start: m.index, open, end });
    re.lastIndex = end;
  }
  return out;
}

/** Names bound by `let x := <expr>` / `x := <expr>` inside the block. */
function bindings(block: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const re = /(?:\blet\s+)?(?<![\w$.])([A-Za-z_$][\w$]*)\s*:=\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const start = m.index + m[0].length;
    const head = /^[\w$.]+/.exec(block.slice(start));
    if (!head) continue;
    let end = start + head[0].length;
    const open = block.slice(end).match(/^\s*\(/);
    if (open) {
      const close = findMatching(block, end + open[0].length - 1, '(', ')');
      if (close !== -1) end = close + 1;
    }
    map.set(m[1], [...(map.get(m[1]) ?? []), block.slice(start, end).trim()]);
  }
  return map;
}

type SlotOrigin = 'namespaced' | 'literal-small' | 'user' | 'unknown';

function slotOrigin(expr: string, vars: Map<string, string[]>, params: Set<string>, depth = 0): SlotOrigin {
  const e = expr.trim();
  if (/keccak256\s*\(/.test(e) || /\.slot\b/.test(e) || /^[A-Z][A-Z0-9_]+$/.test(e)) return 'namespaced';
  const lit = literal(e);
  if (lit !== null) return lit < 0x10000 ? 'literal-small' : 'namespaced';
  if (/\bcalldataload\s*\(/.test(e)) return 'user';
  const ids = e.match(/[A-Za-z_$][\w$]*/g) ?? [];
  let result: SlotOrigin = 'unknown';
  for (const id of ids) {
    if (params.has(id) && !vars.has(id)) return 'user';
    if (depth < 4 && vars.has(id)) {
      for (const rhs of vars.get(id)!) {
        const o = slotOrigin(rhs, vars, params, depth + 1);
        if (o === 'namespaced') return 'namespaced';
        if (o === 'user') result = 'user';
      }
    }
  }
  return result;
}

export function detectUnsafeAssembly(input: unknown): AssemblyResult {
  const prep = prepareSource(input);
  if (!prep.ok) return { ruleId: RULE_ID, analyzed: false, findings: [], diagnostics: prep.diagnostics, blocks: 0 };
  const { source, masked } = prep.prepared;
  const diagnostics: Diagnostic[] = [...prep.diagnostics];
  const src = buildSourceModel(masked, source, diagnostics);
  const findings: SecurityFinding[] = [];
  let blocks = 0;

  for (const model of src.contracts.values()) {
    for (const fn of [...model.functions, ...model.modifiers.values()] as SolFunction[]) {
      if (fn.contract !== model.contract.name || !fn.hasBody) continue;
      const params = new Set(fn.params.map((p) => p.name).filter(Boolean));
      for (const b of assemblyBlocks(fn.body)) {
        blocks++;
        const text = fn.body.slice(b.open + 1, b.end);
        const header = source.slice(fn.bodyOffset + b.start, fn.bodyOffset + b.open);
        const memorySafe = /memory-safe/.test(header);
        const at = (index: number) => fn.bodyOffset + b.open + 1 + index;
        const add = (index: number, f: Omit<SecurityFinding, 'ruleId' | 'line' | 'column' | 'contract' | 'function'>) =>
          findings.push(makeFinding(source, at(index), { ruleId: RULE_ID, contract: model.contract.name, function: fn.name, ...f }));

        const vars = bindings(text);
        const pointerVars = new Set<string>();
        for (const [name, rhs] of vars) if (rhs.some(isFreePointerRead)) pointerVars.add(name);
        const calls = yulCalls(text, [...MEMORY_WRITES, 'sstore']);
        const advancesPointer = calls.some((c) => c.name === 'mstore' && literal(c.args[0] ?? '') === 0x40);
        const exits = /\b(return|revert)\s*\(/.test(text);

        for (const c of calls) {
          const dest = c.args[0] ?? '';
          const destLit = literal(dest);

          if (c.name === 'mstore' && destLit === 0x40) {
            const v = literal(c.args[1] ?? '');
            if (v !== null && v < 0x80) {
              add(c.index, {
                kind: 'free-pointer-corruption', severity: 'high', confidence: 'high',
                message: `mstore(0x40, ${c.args[1]}) sets the free memory pointer to ${c.args[1]}, inside the scratch/reserved area (below 0x80).`,
                severityRationale: 'Following Solidity allocations overwrite the scratch space, the free pointer and the zero slot, corrupting memory; severity high.',
                confidenceEvidence: ['destination is the literal free-pointer slot 0x40', `stored value is the literal ${c.args[1]} < 0x80`],
                remediation: 'Store a pointer at or above 0x80 derived from the previous free pointer, e.g. mstore(0x40, add(ptr, size)).',
                details: { operation: 'mstore', destination: dest, value: c.args[1] },
              });
            }
          } else if (c.name === 'mstore' && destLit === 0x60) {
            const v = literal(c.args[1] ?? '');
            const restored = calls.some((o) => o !== c && o.name === 'mstore' && literal(o.args[0] ?? '') === 0x60 && literal(o.args[1] ?? '') === 0);
            if (v !== 0 && !restored) {
              add(c.index, {
                kind: 'zero-slot-overwrite', severity: 'medium', confidence: 'high',
                message: 'mstore(0x60, ...) overwrites the zero slot and the block never restores it to zero.',
                severityRationale: 'Empty dynamic memory arrays point at the zero slot; a non-zero value there corrupts them; severity medium.',
                confidenceEvidence: ['destination is the literal zero slot 0x60', 'no mstore(0x60, 0) restores it in the block'],
                remediation: 'Do not use 0x60 as scratch; restore it with mstore(0x60, 0) before leaving the block.',
                details: { operation: 'mstore', destination: dest },
              });
            }
          } else if (MEMORY_WRITES.has(c.name) && (isFreePointerRead(dest) || pointerVars.has(dest)) && !advancesPointer && !exits) {
            add(c.index, {
              kind: 'unallocated-memory-write', severity: 'medium', confidence: 'medium',
              message: `${c.name} writes at the free memory pointer but the block never advances it with mstore(0x40, ...).`,
              severityRationale: 'The next Solidity allocation reuses the same bytes and silently overwrites the data written here; severity medium.',
              confidenceEvidence: [`destination ${dest} comes from mload(0x40)`, 'no mstore(0x40, ...) and no return/revert in the block'],
              remediation: 'Advance the free pointer past the written data (mstore(0x40, add(ptr, size))) or return/revert from the block.',
              details: { operation: c.name, destination: dest },
            });
          }

          if (memorySafe && MEMORY_WRITES.has(c.name) && destLit !== null && destLit >= 0x40 && !(c.name === 'mstore' && destLit === 0x40)) {
            add(c.index, {
              kind: 'memory-safe-violation', severity: 'medium', confidence: 'high',
              message: `The block is annotated ("memory-safe") but ${c.name} writes to fixed offset ${dest}, outside the scratch space (0x00-0x3f).`,
              severityRationale: 'The optimizer relies on the annotation to move memory; writing to a fixed offset can corrupt variables it relocated; severity medium.',
              confidenceEvidence: ['annotation "memory-safe" on the assembly block', `literal destination ${dest} >= 0x40`],
              remediation: 'Allocate with the free pointer, use only 0x00-0x3f as scratch, or remove the memory-safe annotation.',
              details: { operation: c.name, destination: dest },
            });
          }

          if (c.name === 'sstore') {
            const origin = slotOrigin(dest, vars, params);
            if (origin === 'literal-small') {
              add(c.index, {
                kind: 'fixed-storage-slot-write', severity: 'medium', confidence: 'medium',
                message: `sstore(${dest}, ...) writes a low fixed slot that overlaps the slots Solidity assigns to state variables.`,
                severityRationale: 'A literal low slot can silently overwrite a state variable; severity medium.',
                confidenceEvidence: [`slot ${dest} is a literal below 0x10000`],
                remediation: 'Use a namespaced slot (keccak256-derived constant, ERC-7201) or the .slot of a declared variable.',
                details: { operation: 'sstore', slot: dest },
              });
            } else if (origin === 'user') {
              const open = fn.visibility === 'external' || fn.visibility === 'public';
              const guarded = fn.modifiers.length > 0;
              add(c.index, {
                kind: 'user-controlled-storage-slot', severity: open && !guarded ? 'high' : 'medium', confidence: open ? 'high' : 'medium',
                message: `sstore(${dest}, ...) uses a slot derived from caller-supplied data without hashing it into a namespace.`,
                severityRationale: open && !guarded
                  ? 'Any caller can pick the slot and overwrite owner, balances or implementation addresses; severity high.'
                  : 'The function is internal or modifier-guarded, which limits who can pick the slot; severity medium.',
                confidenceEvidence: ['slot expression depends on a function parameter or calldataload', `visibility: ${fn.visibility}`, `modifiers: ${fn.modifiers.join(', ') || 'none'}`],
                remediation: 'Derive the slot with keccak256 over a fixed namespace plus the key, or validate the slot against an allow-list.',
                details: { operation: 'sstore', slot: dest, visibility: fn.visibility },
              });
            }
          }
        }
      }
    }
  }
  return { ruleId: RULE_ID, analyzed: true, findings, diagnostics, blocks };
}
