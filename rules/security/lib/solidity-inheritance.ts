/**
 * solidity-inheritance — resolves inheritance for the lexical detectors built on solidity-lite.
 *
 * For every contract defined in the analyzed source it computes a linearization (most derived
 * first, approximating Solidity's C3 order), the effective function set after overrides, the
 * effective modifier set (a derived `virtual` modifier replaces the base one) and the visible
 * state variables. It also resolves internal calls, including `super.f()`, so detectors can follow
 * a call chain across functions and across base contracts.
 *
 * The linearization is Solidity's C3 order (`contract D is B, C` resolves C before B); a cyclic or
 * inconsistent hierarchy falls back to an approximate order with an `inconsistent-linearization`
 * diagnostic. `modifierExecutionOrder` gives the order modifiers run in, and `libraryCallTaint`
 * follows tainted arguments through internal library functions to their return values.
 *
 * Limits: bases that are not defined in the same source (imported libraries such as OpenZeppelin)
 * are reported in `unresolvedBases` and are never guessed at; overloads are matched by their
 * parameter type text; no compiler or project configuration is read or executed.
 */
import {
  Diagnostic,
  SolContract,
  SolFunction,
  SolStateVar,
  extractContracts,
  extractFunctions,
  extractStateVars,
  findMatching,
  splitTopLevel,
  statementsOf,
} from './solidity-lite';

export interface ContractModel {
  contract: SolContract;
  /** The contract followed by its in-source bases, most derived first. */
  linearization: SolContract[];
  /** Base names that are not defined in the analyzed source. */
  unresolvedBases: string[];
  /** Effective functions (overrides resolved): functions with bodies, receive and fallback. */
  functions: SolFunction[];
  /** Effective modifiers by name. */
  modifiers: Map<string, SolFunction>;
  /** State variables declared in the contract and its in-source bases. */
  stateVars: SolStateVar[];
  /** True when no other contract in the source inherits from this one. */
  isLeaf: boolean;
  /** Every function declared in each contract of the linearization, including ones hidden by overrides. */
  own: Map<string, SolFunction[]>;
}

export interface SourceModel {
  contracts: Map<string, ContractModel>;
  /** Every function and modifier in the source, in declaration order. */
  allFunctions: SolFunction[];
}

export function signatureOf(fn: SolFunction): string {
  return `${fn.name}(${fn.params.map((p) => p.type.replace(/\s+/g, ' ')).join(',')})`;
}

const WELL_KNOWN_BASE_RE = /^(Ownable\w*|Pausable\w*|ReentrancyGuard\w*|ERC\d+\w*|AccessControl\w*|Initializable|UUPSUpgradeable|Context\w*|I[A-Z]\w*)$/;

export function isWellKnownBase(name: string): boolean {
  return WELL_KNOWN_BASE_RE.test(name);
}

/**
 * Solidity's C3 linearization over the bases defined in the source: `contract D is B, C` gives
 * D + merge(L(C), L(B), [C, B]). Returns null for a cycle or an inconsistent hierarchy.
 */
function c3(name: string, byName: Map<string, SolContract>, stack: Set<string> = new Set()): string[] | null {
  const c = byName.get(name);
  if (!c || stack.has(name)) return null;
  stack.add(name);
  const bases = c.bases.filter((b) => byName.has(b)).reverse();
  const seqs: string[][] = [];
  for (const b of bases) {
    const l = c3(b, byName, stack);
    if (!l) return null;
    seqs.push(l);
  }
  stack.delete(name);
  seqs.push([...bases]);
  const out = [name];
  while (seqs.some((s) => s.length > 0)) {
    const head = seqs.map((s) => s[0]).find((h) => h !== undefined && !seqs.some((s) => s.indexOf(h) > 0));
    if (head === undefined) return null;
    out.push(head);
    for (const s of seqs) if (s[0] === head) s.shift();
  }
  return out;
}

function linearize(name: string, byName: Map<string, SolContract>, diagnostics: Diagnostic[] = []): SolContract[] {
  const order = c3(name, byName);
  if (order) return order.map((n) => byName.get(n)!);
  diagnostics.push({ level: 'warning', code: 'inconsistent-linearization', message: `${name}: inheritance cannot be linearized; using an approximate base order.` });
  return linearizeApprox(name, byName);
}

function linearizeApprox(name: string, byName: Map<string, SolContract>, seen: Set<string> = new Set()): SolContract[] {
  const c = byName.get(name);
  if (!c || seen.has(name)) return [];
  seen.add(name);
  const out: SolContract[] = [c];
  // Solidity gives the right-most base the highest precedence after the contract itself.
  for (const base of [...c.bases].reverse()) {
    for (const b of linearizeApprox(base, byName, seen)) out.push(b);
  }
  return out;
}

/** Builds the per-contract inheritance model for a masked source. Never throws. */
export function buildSourceModel(masked: string, source: string, diagnostics: Diagnostic[] = []): SourceModel {
  const contracts = extractContracts(masked, diagnostics);
  const allFunctions = extractFunctions(masked, source, contracts, diagnostics);
  const stateVars = extractStateVars(masked, source, contracts);
  const byName = new Map<string, SolContract>();
  for (const c of contracts) byName.set(c.name, c);
  const baseNames = new Set<string>();
  for (const c of contracts) for (const b of c.bases) baseNames.add(b);

  const models = new Map<string, ContractModel>();
  for (const c of contracts) {
    const linearization = linearize(c.name, byName, diagnostics);
    const unresolvedBases: string[] = [];
    for (const l of linearization) for (const b of l.bases) if (!byName.has(b) && !unresolvedBases.includes(b)) unresolvedBases.push(b);

    const functions: SolFunction[] = [];
    const modifiers = new Map<string, SolFunction>();
    const seen = new Set<string>();
    for (const l of linearization) {
      for (const f of allFunctions) {
        if (f.contract !== l.name) continue;
        if (f.kind === 'modifier') {
          if (!modifiers.has(f.name)) modifiers.set(f.name, f);
          continue;
        }
        if (!f.hasBody || f.kind === 'constructor') continue;
        const key = f.kind === 'function' ? signatureOf(f) : f.kind;
        if (seen.has(key)) continue;
        seen.add(key);
        functions.push(f);
      }
    }
    models.set(c.name, {
      contract: c,
      linearization,
      unresolvedBases,
      functions,
      modifiers,
      stateVars: stateVars.filter((v) => linearization.some((l) => l.name === v.contract)),
      isLeaf: !baseNames.has(c.name),
      own: new Map(linearization.map((l) => [l.name, allFunctions.filter((f) => f.contract === l.name && f.kind === 'function' && f.hasBody)])),
    });
  }
  return { contracts: models, allFunctions };
}

const BARE_CALL_RE = /(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g;
const THIS_CALL_RE = /\bthis\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g;
const SUPER_CALL_RE = /\bsuper\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g;

/**
 * Functions of the contract model that `fn` calls directly: bare internal calls, `this.f()` and
 * `super.f()`. `super` resolves to the next definition after `fn`'s own contract in the
 * linearization; calls to names that are not defined in the source are ignored.
 */
export function calleesOf(model: ContractModel, fn: SolFunction, text: string = fn.body): SolFunction[] {
  const out: SolFunction[] = [];
  const add = (f: SolFunction | undefined) => {
    if (f && !out.includes(f)) out.push(f);
  };
  const byName = (name: string) => model.functions.filter((f) => f.kind === 'function' && f.name === name);

  for (const re of [BARE_CALL_RE, THIS_CALL_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) for (const f of byName(m[1])) add(f);
  }

  SUPER_CALL_RE.lastIndex = 0;
  let sm: RegExpExecArray | null;
  while ((sm = SUPER_CALL_RE.exec(text)) !== null) {
    const from = model.linearization.findIndex((c) => c.name === fn.contract);
    for (let i = from + 1; i < model.linearization.length; i++) {
      const cands = (model.own.get(model.linearization[i].name) ?? []).filter((f) => f.name === sm![1]);
      const hit = cands.find((f) => signatureOf(f) === signatureOf(fn)) ?? cands[0];
      if (hit) {
        add(hit);
        break;
      }
    }
  }
  return out;
}

/** Comment text directly above `offset` (block or consecutive line comments). */
export function leadingComment(source: string, offset: number): string {
  const before = source.slice(Math.max(0, offset - 2000), offset).trimEnd();
  if (before.endsWith('*/')) return before.slice(before.lastIndexOf('/*'));
  const lines = before.split('\n');
  const out: string[] = [];
  for (let i = lines.length - 1; i >= 0 && lines[i].trim().startsWith('//'); i--) out.unshift(lines[i].trim());
  return out.join('\n');
}

export interface ModifierStep {
  name: string;
  /** Effective definition after overrides; undefined when the modifier is not in the source. */
  definition?: SolFunction;
  /** Modifier code that runs before the function body (before the first `_;`). */
  before: string;
  /** Modifier code that runs after the function body (after the first `_;`). */
  after: string;
  /** True when the modifier has no `_;`, so the function body never runs. */
  skipsBody: boolean;
}

/**
 * Modifiers of `fn` in execution order: Solidity runs them left to right as written, each one's
 * code before `_;` runs before the next modifier, and the code after `_;` unwinds in reverse order
 * once the body returns. Base-constructor calls in a constructor header are not modifiers and are
 * left out.
 */
export function modifierExecutionOrder(model: ContractModel, fn: SolFunction): ModifierStep[] {
  const bases = new Set(model.linearization.map((c) => c.name).concat(model.unresolvedBases));
  return fn.modifiers
    .filter((m) => !bases.has(m))
    .map((name) => {
      const definition = model.modifiers.get(name);
      const body = definition?.body ?? '';
      const idx = body.search(/(?<![\w$])_\s*;/);
      return {
        name,
        definition,
        before: idx === -1 ? body : body.slice(0, idx),
        after: idx === -1 ? '' : body.slice(body.indexOf(';', idx) + 1),
        skipsBody: !!definition && idx === -1,
      };
    });
}

/** Human-readable order for finding details, e.g. `nonReentrant > onlyOwner > body > onlyOwner(after)`. */
export function formatModifierOrder(steps: ModifierStep[]): string {
  const pre = steps.map((s) => s.name);
  const post = [...steps].reverse().filter((s) => s.after.trim()).map((s) => `${s.name}(after)`);
  return [...pre, 'body', ...post].join(' > ');
}

export interface LibraryTaint {
  /** True when a tainted argument can reach the call's return value. */
  tainted: boolean;
  /** False when the library function is not defined in the source (treated as tainted). */
  resolved: boolean;
  /** Library functions followed, as `Lib.fn:line`. */
  path: string[];
}

const LIB_CALL_RE = /(?<![\w$])([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g;
const MAX_LIB_DEPTH = 4;

const mentions = (text: string, names: Iterable<string>) =>
  [...names].some((n) => new RegExp(`(?<![\w$.])${n.replace(/[$]/g, '\$')}(?![\w$])`).test(text));

function libraryFunction(source: SourceModel, receiver: string, name: string, argc: number): { fn: SolFunction; bound: boolean } | undefined {
  const isLib = (c: string | undefined) => !!c && source.contracts.get(c)?.contract.kind === 'library';
  const fns = source.allFunctions.filter((f) => f.kind === 'function' && f.hasBody && f.name === name && isLib(f.contract));
  const direct = fns.find((f) => f.contract === receiver && f.params.length === argc);
  if (direct) return { fn: direct, bound: false };
  if (isLib(receiver)) return undefined;
  // `using L for T`: `x.f(a)` calls `L.f(x, a)`.
  const bound = fns.find((f) => f.params.length === argc + 1);
  return bound ? { fn: bound, bound: true } : undefined;
}

function returnTainted(source: SourceModel, fn: SolFunction, taintedParams: Set<string>, depth: number, path: string[]): boolean {
  const tainted = new Set(taintedParams);
  const named = fn.returnsText ? splitTopLevel(fn.returnsText, ',').map((r) => r.trim().split(/\s+/).pop() ?? '').filter((n) => /^[A-Za-z_$][\w$]*$/.test(n) && !/^(u?int\d*|bool|address|bytes\d*|string|memory|storage|calldata|payable)$/.test(n)) : [];
  for (const st of statementsOf(fn)) {
    const ret = /^return\b([\s\S]*)$/.exec(st.text);
    if (ret) {
      if (exprTainted(source, ret[1], tainted, depth, path)) return true;
      continue;
    }
    const asg = /^(?:[\w$.\[\]\s]+?\s+(?:memory\s+|storage\s+|calldata\s+)?)?([A-Za-z_$][\w$]*)\s*[+\-*/|&^]?=(?!=)([\s\S]*)$/.exec(st.text);
    if (asg && exprTainted(source, asg[2], tainted, depth, path)) tainted.add(asg[1]);
  }
  return named.some((n) => tainted.has(n));
}

/** True when `expr` can carry a tainted value, following library calls defined in the source. */
function exprTainted(source: SourceModel, expr: string, tainted: Set<string>, depth: number, path: string[]): boolean {
  let rest = expr;
  LIB_CALL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  const calls: { start: number; end: number; receiver: string; name: string; args: string[] }[] = [];
  while ((m = LIB_CALL_RE.exec(expr)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = findMatching(expr, open, '(', ')');
    if (close === -1) break;
    const argText = expr.slice(open + 1, close);
    calls.push({ start: m.index, end: close + 1, receiver: m[1], name: m[2], args: argText.trim() ? splitTopLevel(argText, ',') : [] });
    LIB_CALL_RE.lastIndex = close + 1;
  }
  for (const call of [...calls].reverse()) {
    const r = depth < MAX_LIB_DEPTH ? libraryFunction(source, call.receiver, call.name, call.args.length) : undefined;
    if (!r) continue;
    const args = r.bound ? [call.receiver, ...call.args] : call.args;
    const params = new Set(r.fn.params.map((p, i) => (mentions(args[i] ?? '', tainted) ? p.name : '')).filter(Boolean));
    path.push(`${r.fn.contract}.${r.fn.name}:${r.fn.line}`);
    if (params.size > 0 && returnTainted(source, r.fn, params, depth + 1, path)) return true;
    rest = rest.slice(0, call.start) + rest.slice(call.end);
  }
  return mentions(rest, tainted);
}

/**
 * Whether a call to an internal library function, `Lib.f(args)` or `x.f(args)` through
 * `using Lib for T`, can return a tainted value. Tainted arguments are mapped to the library
 * function's parameters and followed through local assignments, `return` statements, named
 * return values and nested library calls (up to four levels). Calls whose library is not in the
 * source are treated as tainted when any argument is tainted, with `resolved: false`.
 */
export function libraryCallTaint(source: SourceModel, callExpr: string, tainted: Iterable<string>): LibraryTaint {
  const names = new Set(tainted);
  const m = /^\s*([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(callExpr);
  if (!m) return { tainted: mentions(callExpr, names), resolved: false, path: [] };
  const close = findMatching(callExpr, m[0].length - 1, '(', ')');
  const argText = callExpr.slice(m[0].length, close === -1 ? callExpr.length : close);
  const argc = argText.trim() ? splitTopLevel(argText, ',').length : 0;
  if (!libraryFunction(source, m[1], m[2], argc)) return { tainted: mentions(callExpr, names), resolved: false, path: [] };
  const path: string[] = [];
  return { tainted: exprTainted(source, callExpr, names, 0, path), resolved: true, path };
}
