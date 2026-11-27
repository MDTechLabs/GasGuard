/**
 * project-model — bounded, multi-file contract model for the call-safety detectors.
 *
 * Builds, from the Solidity sources handed to it (never from the file system), a model of
 * contracts, inheritance, state variables and functions, plus an ordered "timeline" of storage
 * writes and external calls for a function with internal helpers and inherited functions inlined.
 *
 * Supported input: Solidity 0.6 – 0.8.x source text. Compiler settings, remappings, imports and
 * project configuration are never read or trusted: resolution is by contract name across the
 * supplied sources only. Analysis is lexical (see solidity-lite.ts) and bounded: file count,
 * total size, inheritance depth, inlining depth and events per function are all capped, and a cap
 * being hit is reported as a limitation rather than silently ignored.
 */
import {
  Diagnostic,
  MAX_SOURCE_LENGTH,
  SolContract,
  SolFunction,
  SolStateVar,
  extractContracts,
  extractFunctions,
  extractStateVars,
  findMatching,
  maskCommentsAndStrings,
  splitTopLevel,
  statementsOf,
} from './solidity-lite';

export interface ProjectSource {
  /** Label used in findings. Never opened as a file. */
  path: string;
  content: string;
}

export interface ProjectLimits {
  maxFiles: number;
  maxTotalChars: number;
  maxInheritanceDepth: number;
  maxInlineDepth: number;
  maxEventsPerFunction: number;
}

export const DEFAULT_LIMITS: ProjectLimits = {
  maxFiles: 200,
  maxTotalChars: 3_000_000,
  maxInheritanceDepth: 12,
  maxInlineDepth: 4,
  maxEventsPerFunction: 1_500,
};

export interface ModelState extends SolStateVar {
  file: string;
  public: boolean;
  /** Mapping value / array element / plain type, without indexing suffixes. */
  valueType: string;
}

export interface ModelFunction extends SolFunction {
  file: string;
  contractName: string;
}

export interface ModelContract {
  name: string;
  kind: SolContract['kind'];
  file: string;
  /** Offset of the contract body's opening brace in its file. */
  open: number;
  bases: string[];
  stateVars: ModelState[];
  functions: ModelFunction[];
}

export interface ProjectModel {
  files: Map<string, { source: string; masked: string }>;
  contracts: Map<string, ModelContract>;
  /** Struct and enum names declared anywhere in the project; not treated as external call targets. */
  valueTypes: Set<string>;
  diagnostics: Diagnostic[];
  limits: ProjectLimits;
  /** Set when a bound was hit and part of the input was not analyzed. */
  truncated: boolean;
}

// ---------------------------------------------------------------------------------------
// Building the model
// ---------------------------------------------------------------------------------------

function validPath(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && path.length <= 512 && !/[\u0000-\u001f]/.test(path);
}

function valueTypeOf(type: string): string {
  const afterMapping = type.includes('=>') ? type.slice(type.lastIndexOf('=>') + 2) : type;
  return afterMapping.replace(/\)+\s*$/, '').replace(/(\[\s*\d*\s*\])+\s*$/, '').trim();
}

/** Validates and models the given sources. Never throws; invalid input yields `ok: false`. */
export function buildProjectModel(
  input: unknown,
  limitOverrides: Partial<ProjectLimits> = {},
): { ok: true; model: ProjectModel } | { ok: false; diagnostics: Diagnostic[] } {
  const limits = { ...DEFAULT_LIMITS, ...limitOverrides };
  const diagnostics: Diagnostic[] = [];
  let sources: ProjectSource[];
  if (typeof input === 'string') sources = [{ path: 'source.sol', content: input }];
  else if (Array.isArray(input)) sources = input as ProjectSource[];
  else {
    return { ok: false, diagnostics: [{ level: 'error', code: 'invalid-input', message: 'Input must be a source string or an array of { path, content }.' }] };
  }
  if (sources.length === 0) {
    return { ok: false, diagnostics: [{ level: 'error', code: 'empty-input', message: 'No sources supplied.' }] };
  }

  const model: ProjectModel = {
    files: new Map(),
    contracts: new Map(),
    valueTypes: new Set(),
    diagnostics,
    limits,
    truncated: false,
  };
  let total = 0;
  for (const src of sources) {
    if (model.files.size >= limits.maxFiles) {
      model.truncated = true;
      diagnostics.push({ level: 'warning', code: 'too-many-files', message: `Only the first ${limits.maxFiles} files were analyzed.` });
      break;
    }
    if (!src || !validPath(src.path) || typeof src.content !== 'string') {
      diagnostics.push({ level: 'warning', code: 'invalid-source', message: 'Skipped an entry without a valid path and string content.' });
      continue;
    }
    if (model.files.has(src.path)) {
      diagnostics.push({ level: 'warning', code: 'duplicate-path', message: `Duplicate path ${src.path}; the first occurrence was kept.` });
      continue;
    }
    if (src.content.length > MAX_SOURCE_LENGTH || total + src.content.length > limits.maxTotalChars) {
      model.truncated = true;
      diagnostics.push({ level: 'warning', code: 'source-too-large', message: `${src.path} skipped: size bound exceeded.` });
      continue;
    }
    total += src.content.length;
    const masked = maskCommentsAndStrings(src.content);
    model.files.set(src.path, { source: src.content, masked });
    for (const m of masked.matchAll(/\b(?:struct|enum)\s+([A-Za-z_$][\w$]*)/g)) model.valueTypes.add(m[1]);
  }

  for (const [path, { source, masked }] of model.files) {
    const fileDiagnostics: Diagnostic[] = [];
    const contracts = extractContracts(masked, fileDiagnostics);
    if (contracts.length === 0) {
      diagnostics.push({ level: 'warning', code: 'no-contract', message: `${path} declares no contract, library or interface.` });
      continue;
    }
    for (const d of fileDiagnostics) diagnostics.push({ ...d, message: `${path}: ${d.message}` });
    const states = extractStateVars(masked, source, contracts);
    const functions = extractFunctions(masked, source, contracts, []);
    for (const c of contracts) {
      if (model.contracts.has(c.name)) {
        diagnostics.push({ level: 'warning', code: 'duplicate-contract', message: `Contract ${c.name} is declared more than once; ${path} declaration ignored.` });
        continue;
      }
      model.contracts.set(c.name, {
        name: c.name,
        kind: c.kind,
        file: path,
        open: c.open,
        bases: c.bases,
        stateVars: states
          .filter((s) => s.contract === c.name)
          .map((s) => {
            const end = masked.indexOf(';', s.offset);
            const decl = masked.slice(s.offset, end === -1 ? s.offset : end);
            return { ...s, file: path, public: /\bpublic\b/.test(decl), valueType: valueTypeOf(s.type) };
          }),
        functions: functions.filter((f) => f.contract === c.name).map((f) => ({ ...f, file: path, contractName: c.name })),
      });
    }
  }
  if (model.contracts.size === 0) {
    return { ok: false, diagnostics: [...diagnostics, { level: 'error', code: 'no-contract', message: 'No contract, library or interface declaration found; input is not supported Solidity.' }] };
  }
  return { ok: true, model };
}

// ---------------------------------------------------------------------------------------
// Inheritance and lookup
// ---------------------------------------------------------------------------------------

/** Method resolution order, most derived first. Unknown (unresolved) bases are skipped. */
export function mro(model: ProjectModel, name: string, depth = 0, seen: Set<string> = new Set()): string[] {
  const contract = model.contracts.get(name);
  if (!contract || depth > model.limits.maxInheritanceDepth || seen.has(name)) return contract ? [name] : [];
  seen.add(name);
  const flat: string[] = [name];
  // Later bases are "more derived" in Solidity linearization.
  for (const base of [...contract.bases].reverse()) flat.push(...mro(model, base, depth + 1, new Set(seen)));
  seen.delete(name);
  // Keep the last occurrence so shared bases sort after everything that inherits them.
  return flat.filter((n, i) => flat.lastIndexOf(n) === i);
}

/** Base names that could not be resolved inside the supplied sources. */
export function unresolvedBases(model: ProjectModel, name: string): string[] {
  const out: string[] = [];
  for (const n of mro(model, name)) {
    for (const b of model.contracts.get(n)?.bases ?? []) if (!model.contracts.has(b)) out.push(b);
  }
  return [...new Set(out)];
}

export function stateVarsOf(model: ProjectModel, name: string): Map<string, ModelState> {
  const out = new Map<string, ModelState>();
  for (const n of [...mro(model, name)].reverse()) {
    for (const v of model.contracts.get(n)?.stateVars ?? []) out.set(v.name, v);
  }
  return out;
}

/** All functions visible on a contract; the most derived override wins (keyed by name/arity). */
export function functionsOf(model: ProjectModel, name: string): ModelFunction[] {
  const seen = new Set<string>();
  const out: ModelFunction[] = [];
  for (const n of mro(model, name)) {
    for (const f of model.contracts.get(n)?.functions ?? []) {
      const key = `${f.kind}:${f.name}/${f.params.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(f);
    }
  }
  return out;
}

export function findFunction(model: ProjectModel, contract: string, name: string, arity?: number): ModelFunction | undefined {
  const candidates = functionsOf(model, contract).filter((f) => f.name === name && f.kind === 'function');
  return candidates.find((f) => arity === undefined || f.params.length === arity) ?? (arity === undefined ? undefined : candidates[0]);
}

export function findModifier(model: ProjectModel, contract: string, name: string): ModelFunction | undefined {
  return functionsOf(model, contract).find((f) => f.kind === 'modifier' && f.name === name);
}

export function isExternallyCallable(fn: SolFunction): boolean {
  return fn.kind === 'function' && fn.hasBody && (fn.visibility === 'public' || fn.visibility === 'external');
}

export function isStateChanging(fn: SolFunction): boolean {
  return fn.mutability !== 'view' && fn.mutability !== 'pure';
}

// ---------------------------------------------------------------------------------------
// Accounting classification and guards
// ---------------------------------------------------------------------------------------

export type AccountingKind = 'asset' | 'liability';

const LIABILITY_RE = /(debt|owed|owe[sd]?\b|borrow|liabilit|shares?|supply|claimable|credit|obligation|withdrawable|unclaimed|reward|principal|nonce)/i;
const ASSET_RE = /(balance|asset|reserve|collateral|deposit|holding|treasury|escrow|stake|liquidity|funds|total|pool|vault|lockedamount|amount)/i;
const NOT_ACCOUNTING_RE = /^(_?status|_?locked|_?unlocked|_?entered|_?paused|_?initialized|_?owner|_?admin|_?decimals|_?name|_?symbol)$/i;

/** Accounting classification by declared name and type; undefined for non-accounting state. */
export function classifyAccounting(v: Pick<ModelState, 'name' | 'type' | 'constant' | 'immutable' | 'valueType'>): AccountingKind | undefined {
  if (v.constant || v.immutable || NOT_ACCOUNTING_RE.test(v.name)) return undefined;
  if (/^(bool|address|string|bytes\d*)\b/.test(v.valueType) || /^[A-Z]/.test(v.valueType)) return undefined;
  if (/nonce/i.test(v.name)) return undefined;
  if (LIABILITY_RE.test(v.name)) return 'liability';
  if (ASSET_RE.test(v.name)) return 'asset';
  return undefined;
}

const GUARD_NAME_RE = /^(non_?reentrant\w*|reentrancy_?guard\w*|no_?reentr\w*|lock|mutex|noReentry|nonReentrantView|whenNotEntered)$/i;
const GUARD_BODY_RE = /(_status|\blocked\b|_entered|_notEntered|\bunlocked\b|ENTERED|_reentrancyGuardEntered)/;
const VIEW_GUARD_BODY_RE = /(_requireNotEntered|_checkNotEntered|_reentrancyGuardEntered|nonReentrantView|require\s*\(\s*!\s*_?locked|require\s*\(\s*_?unlocked|_status\s*!=\s*_?ENTERED|_status\s*==\s*_?NOT_ENTERED)/;

/** Does the function hold a reentrancy lock (modifier by name, or a project modifier that writes a lock)? */
export function hasReentrancyLock(model: ProjectModel, contract: string, fn: SolFunction): { guarded: boolean; modifier?: string } {
  for (const m of fn.modifiers) {
    if (GUARD_NAME_RE.test(m)) return { guarded: true, modifier: m };
    const mod = findModifier(model, contract, m);
    if (mod && GUARD_BODY_RE.test(mod.body)) return { guarded: true, modifier: m };
  }
  return { guarded: false };
}

/** Does a view function refuse to answer while the contract's lock is held (read-only reentrancy guard)? */
export function hasViewLockCheck(model: ProjectModel, contract: string, fn: SolFunction): boolean {
  if (VIEW_GUARD_BODY_RE.test(fn.body)) return true;
  return fn.modifiers.some((m) => {
    if (/^nonReentrantView$|^whenNotEntered$/i.test(m)) return true;
    const mod = findModifier(model, contract, m);
    return !!mod && VIEW_GUARD_BODY_RE.test(mod.body);
  });
}

const VIEW_METHOD_RE = /^(balanceOf|allowance|totalSupply|decimals|symbol|name|latestRoundData|latestAnswer|getPrice\w*|totalAssets|convertTo\w+|preview\w+|max\w+|supportsInterface|is[A-Z]\w*|has[A-Z]\w*|owner|nonces|DOMAIN_SEPARATOR)$/;

/** Method names that are read-only by convention (ERC-20/4626/oracle views). Heuristic; the name is the only evidence. */
export function isLikelyViewMethod(name: string): boolean {
  return VIEW_METHOD_RE.test(name);
}

// ---------------------------------------------------------------------------------------
// Call classification and timeline
// ---------------------------------------------------------------------------------------

export type CallClass =
  | 'low-level' // address.call / delegatecall: arbitrary code with caller-chosen gas
  | 'eth-transfer' // address.transfer / send: 2300 gas stipend
  | 'static' // staticcall, view/pure project functions, public getters, view-like interface methods
  | 'resolved' // state-changing function of a project contract
  | 'unresolved' // interface / token / address-typed target outside the supplied sources
  | 'self'; // this.f()

export interface CallSite {
  class: CallClass;
  /** Receiver expression as written. */
  receiver: string;
  method: string;
  /** Declared type of the receiver when known (`IERC20`, `Vault`, `address`). */
  targetType?: string;
  targetContract?: string;
  targetFunction?: ModelFunction;
  /** Set when the call reads a public state variable getter of a project contract. */
  getterVariable?: string;
  valueBearing: boolean;
  delegate: boolean;
  /** True when the target code cannot be resolved from the supplied sources. */
  dynamic: boolean;
  argCount: number;
}

export interface TimelineEvent {
  kind: 'write' | 'call';
  file: string;
  line: number;
  /** Offset in the original text of `file`. */
  offset: number;
  text: string;
  /** Internal helper chain that led to this event, outermost first. */
  via: string[];
  /** Writes: state variable name, and its accounting classification. */
  variable?: string;
  accounting?: AccountingKind;
  call?: CallSite;
}

export interface Timeline {
  events: TimelineEvent[];
  /** State variables (by name, in the analyzed contract's scope) read or written anywhere, helpers included. */
  touched: Set<string>;
  truncated: boolean;
}

const NON_CALL_WORDS = new Set([
  'if', 'for', 'while', 'require', 'assert', 'revert', 'emit', 'return', 'keccak256', 'sha256', 'ripemd160', 'abi', 'type',
  'address', 'payable', 'new', 'delete', 'mapping', 'function', 'super', 'this', 'unchecked', 'else', 'ecrecover', 'selfdestruct',
  'blockhash', 'gasleft', 'addmod', 'mulmod', 'string', 'bool', 'bytes', 'uint', 'int', 'try', 'catch', 'do',
]);
const PRIMITIVE_RE = /^(u?int\d*|bool|bytes\d*|string|fixed|ufixed)$/;
const NON_RECEIVERS = new Set(['abi', 'msg', 'block', 'tx', 'super', 'type']);
const ARRAY_METHODS = new Set(['push', 'pop']);
const LOW_LEVEL_LIBRARY_RE = /^(sendValue|functionCall|functionCallWithValue|functionDelegateCall|functionStaticCall)$/;
const VALUE_METHOD_RE = /(transfer|send|mint|burn|withdraw|deposit|swap|redeem|release|claim|unlock|borrow|repay|liquidate)/i;

function receiverBefore(text: string, dot: number): string {
  let i = dot - 1;
  const end = dot;
  for (;;) {
    while (i >= 0 && /\s/.test(text[i])) i--;
    if (i < 0) break;
    const c = text[i];
    if (c === ')' || c === ']') {
      const open = c === ')' ? '(' : '[';
      let depth = 0;
      while (i >= 0) {
        if (text[i] === c) depth++;
        else if (text[i] === open) {
          depth--;
          if (depth === 0) break;
        }
        i--;
      }
      if (i < 0) return '';
      i--;
      continue;
    }
    if (/[\w$]/.test(c)) {
      while (i >= 0 && /[\w$]/.test(text[i])) i--;
      let j = i;
      while (j >= 0 && /\s/.test(text[j])) j--;
      if (j >= 0 && text[j] === '.') {
        i = j - 1;
        continue;
      }
    }
    break;
  }
  return text.slice(i + 1, end).trim();
}

const LOCAL_DECL_RE =
  /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\s*\[\s*\d*\s*\])*(?:\s+payable)?)\s+(?:(?:memory|storage|calldata)\s+)?([A-Za-z_$][\w$]*)\s*(?:=|$)/;
const DECL_EXCLUDE = new Set(['return', 'emit', 'delete', 'revert', 'require', 'assert', 'else', 'if', 'for', 'while', 'new', 'unchecked', 'try', 'catch']);

interface Scope {
  types: Map<string, string>;
  locals: Set<string>;
  aliases: Map<string, string>;
}

function buildScope(fn: SolFunction, states: Map<string, ModelState>, texts: string[]): Scope {
  const types = new Map<string, string>();
  const locals = new Set<string>();
  const aliases = new Map<string, string>();
  for (const [name, s] of states) types.set(name, s.valueType);
  for (const p of fn.params) {
    if (!p.name) continue;
    types.set(p.name, p.type.replace(/(\[\s*\d*\s*\])+$/, ''));
    locals.add(p.name);
  }
  for (const p of fn.returnsText.split(',')) {
    const toks = p.trim().split(/\s+/);
    if (toks.length > 1 && !/^(memory|calldata|storage)$/.test(toks[toks.length - 1])) {
      locals.add(toks[toks.length - 1]);
      types.set(toks[toks.length - 1], toks[0].replace(/(\[\s*\d*\s*\])+$/, ''));
    }
  }
  for (const text of texts) {
    const d = LOCAL_DECL_RE.exec(text);
    if (!d || DECL_EXCLUDE.has(d[1])) continue;
    const type = d[1].replace(/\s+payable$/, '').replace(/(\[\s*\d*\s*\])+$/, '');
    types.set(d[2], type);
    locals.add(d[2]);
    const alias = /^[^=]*\bstorage\b[^=]*=\s*([A-Za-z_$][\w$]*)/.exec(text);
    if (alias && states.has(alias[1])) {
      aliases.set(d[2], alias[1]);
      locals.delete(d[2]);
    }
  }
  return { types, locals, aliases };
}

function classifyCall(
  model: ProjectModel,
  contract: string,
  scope: Scope,
  states: Map<string, ModelState>,
  receiver: string,
  method: string,
  args: string,
  hasValueOption: boolean,
): CallSite | undefined {
  const argCount = splitTopLevel(args).filter((a) => a.trim()).length;
  const base = { receiver, method, valueBearing: hasValueOption, delegate: false, dynamic: false, argCount };
  if (NON_RECEIVERS.has(receiver) || !receiver) return undefined;
  if (receiver === 'this') return { ...base, class: 'self', targetContract: contract };

  let type: string | undefined;
  const cast = /^([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)$/.exec(receiver);
  if (cast) type = cast[1] === 'payable' ? 'address' : cast[1];
  else {
    const root = /^([A-Za-z_$][\w$]*)(?:\s*\[[^\]]*\])*$/.exec(receiver);
    if (root) type = root[1] === 'msg' ? undefined : scope.types.get(root[1]);
  }
  if (/^(msg\.sender|tx\.origin)$/.test(receiver)) type = 'address';
  if (type && (PRIMITIVE_RE.test(type) || model.valueTypes.has(type) || type.includes('.'))) return undefined;

  const addressLike = !type || type === 'address' || type === 'address payable';
  if (addressLike) {
    if (method === 'call') return { ...base, class: 'low-level', targetType: type, dynamic: true };
    if (method === 'delegatecall') return { ...base, class: 'low-level', targetType: type, delegate: true, dynamic: true, valueBearing: true };
    if (method === 'staticcall') return { ...base, class: 'static', targetType: type, dynamic: true };
    if ((method === 'transfer' && argCount === 1) || method === 'send') return { ...base, class: 'eth-transfer', targetType: type, valueBearing: true };
    if (LOW_LEVEL_LIBRARY_RE.test(method)) return { ...base, class: 'low-level', targetType: type, dynamic: true, valueBearing: true };
    if (!type) return undefined; // unknown receiver (struct member, library chain): not an external call we can name
    return { ...base, class: 'unresolved', targetType: type, dynamic: true };
  }

  const target = model.contracts.get(type!);
  if (target && target.kind !== 'library') {
    const fn = findFunction(model, target.name, method, argCount);
    if (fn) {
      const changing = isStateChanging(fn);
      // An interface / abstract declaration says nothing about the code that will run.
      const abstract = !fn.hasBody;
      return {
        ...base,
        class: changing ? (abstract ? 'unresolved' : 'resolved') : 'static',
        targetType: type,
        targetContract: target.name,
        targetFunction: fn,
        dynamic: changing && abstract,
        valueBearing: hasValueOption || (changing && VALUE_METHOD_RE.test(method)),
      };
    }
    const getter = stateVarsOf(model, target.name).get(method);
    if (getter?.public) return { ...base, class: 'static', targetType: type, targetContract: target.name, getterVariable: getter.name };
    return { ...base, class: 'unresolved', targetType: type, targetContract: target.name, dynamic: true };
  }
  if (target?.kind === 'library') return undefined;
  if (/^[A-Z_$]/.test(type!)) {
    const view = isLikelyViewMethod(method);
    return {
      ...base,
      class: view ? 'static' : 'unresolved',
      targetType: type,
      dynamic: !view,
      valueBearing: hasValueOption || VALUE_METHOD_RE.test(method),
    };
  }
  return undefined;
}

interface Candidate {
  index: number;
  kind: 'internal' | 'external';
  name: string;
  receiver?: string;
  argsText: string;
  hasValueOption: boolean;
}

function findCandidates(text: string, internalNames: Set<string>, model: ProjectModel): Candidate[] {
  const out: Candidate[] = [];
  const ext = /\.\s*([A-Za-z_$][\w$]*)\s*(\{[^{}]*\})?\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = ext.exec(text)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = findMatching(text, open, '(', ')');
    const argsText = text.slice(open + 1, close === -1 ? text.length : close);
    const receiver = receiverBefore(text, m.index);
    if (ARRAY_METHODS.has(m[1])) continue;
    out.push({ index: m.index, kind: 'external', name: m[1], receiver, argsText, hasValueOption: !!m[2] && /\bvalue\s*:/.test(m[2]) });
  }
  const internal = /(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g;
  while ((m = internal.exec(text)) !== null) {
    const name = m[1];
    if (NON_CALL_WORDS.has(name) || !internalNames.has(name) || model.contracts.has(name)) continue;
    const open = m.index + m[0].length - 1;
    const close = findMatching(text, open, '(', ')');
    out.push({ index: m.index, kind: 'internal', name, argsText: text.slice(open + 1, close === -1 ? text.length : close), hasValueOption: false });
  }
  // `super.f(...)` and `Base.f(...)` are internal calls to an inherited implementation.
  return out.sort((a, b) => a.index - b.index);
}

function writeTargets(text: string, states: Map<string, ModelState>, scope: Scope): string[] {
  const out: string[] = [];
  const resolve = (root: string): string | undefined => {
    if (scope.aliases.has(root)) return scope.aliases.get(root);
    if (scope.locals.has(root)) return undefined;
    return states.has(root) ? root : undefined;
  };
  const trimmed = text.trim();
  const push = (root: string) => {
    const v = resolve(root);
    if (v && !out.includes(v)) out.push(v);
  };
  const assign = /^([A-Za-z_$][\w$]*)(?:\s*\.\s*[A-Za-z_$][\w$]*|\s*\[[^\]]*\])*\s*(?:[-+*/%|&^]|<<|>>)?=(?![=>])/.exec(trimmed);
  if (assign) push(assign[1]);
  const del = /^delete\s+([A-Za-z_$][\w$]*)/.exec(trimmed);
  if (del) push(del[1]);
  const incr = /^([A-Za-z_$][\w$]*)(?:\s*\.\s*[A-Za-z_$][\w$]*|\s*\[[^\]]*\])*\s*(?:\+\+|--)/.exec(trimmed) ?? /^(?:\+\+|--)\s*([A-Za-z_$][\w$]*)/.exec(trimmed);
  if (incr) push(incr[1]);
  const arr = /^([A-Za-z_$][\w$]*)(?:\s*\[[^\]]*\])*\s*\.\s*(?:push|pop)\s*\(/.exec(trimmed);
  if (arr) push(arr[1]);
  // `x = f(...)` style declarations with a tuple destructure on state are intentionally not modeled.
  return out;
}

/**
 * Ordered storage writes and external calls of `fn` executing in `contract`'s storage context,
 * with internal helpers and inherited implementations inlined up to `maxInlineDepth`.
 * Branches are flattened in source order (a conservative over-approximation of "after").
 */
export function buildTimeline(model: ProjectModel, contract: string, fn: ModelFunction): Timeline {
  const states = stateVarsOf(model, contract);
  const internals = functionsOf(model, contract);
  const internalNames = new Set(internals.filter((f) => f.kind === 'function' && f.hasBody).map((f) => f.name));
  const timeline: Timeline = { events: [], touched: new Set(), truncated: false };
  const stack: string[] = [];

  const walk = (current: ModelFunction, via: string[], depth: number) => {
    const key = `${current.contractName}.${current.name}/${current.params.length}@${current.offset}`;
    if (stack.includes(key)) return;
    stack.push(key);
    const file = model.files.get(current.file);
    if (!file) {
      stack.pop();
      return;
    }
    const statements = statementsOf(current, file.source);
    const scope = buildScope(current, states, statements.map((s) => s.text));
    for (const st of statements) {
      if (timeline.events.length >= model.limits.maxEventsPerFunction) {
        timeline.truncated = true;
        break;
      }
      for (const w of st.text.match(/[A-Za-z_$][\w$]*/g) ?? []) {
        if (scope.aliases.has(w)) timeline.touched.add(scope.aliases.get(w)!);
        else if (states.has(w) && !scope.locals.has(w)) timeline.touched.add(w);
      }
      for (const cand of findCandidates(st.text, internalNames, model)) {
        const offset = st.offset + cand.index;
        if (cand.kind === 'internal') {
          const target = internals.find((f) => f.kind === 'function' && f.name === cand.name && f.hasBody);
          if (target && depth < model.limits.maxInlineDepth) walk(target, [...via, cand.name], depth + 1);
          else if (target) timeline.truncated = true;
          continue;
        }
        const baseContract = model.contracts.get(cand.receiver ?? '');
        if ((cand.receiver === 'super' || (baseContract && mro(model, contract).includes(baseContract.name))) && internalNames.has(cand.name)) {
          let impl: ModelFunction | undefined;
          if (baseContract) impl = baseContract.functions.find((f) => f.name === cand.name && f.hasBody);
          else {
            // super.f(): the next implementation after the current contract in the linearization.
            const order = mro(model, contract);
            for (const n of order.slice(order.indexOf(current.contractName) + 1)) {
              impl = model.contracts.get(n)?.functions.find((f) => f.name === cand.name && f.hasBody);
              if (impl) break;
            }
          }
          if (impl && depth < model.limits.maxInlineDepth) walk(impl, [...via, `${cand.receiver}.${cand.name}`], depth + 1);
          continue;
        }
        const call = classifyCall(model, contract, scope, states, cand.receiver ?? '', cand.name, cand.argsText, cand.hasValueOption);
        if (call) {
          timeline.events.push({ kind: 'call', file: current.file, line: st.line, offset, text: st.text.slice(0, 120), via, call });
        }
      }
      for (const variable of writeTargets(st.text, states, scope)) {
        const s = states.get(variable)!;
        timeline.touched.add(variable);
        timeline.events.push({
          kind: 'write',
          file: current.file,
          line: st.line,
          offset: st.offset,
          text: st.text.slice(0, 120),
          via,
          variable,
          accounting: classifyAccounting(s),
        });
      }
    }
    stack.pop();
  };
  walk(fn, [], 0);
  return timeline;
}

/** Does the call hand control to code that could re-enter (no stipend limit, not read-only)? */
export function isReentrantInteraction(call: CallSite): boolean {
  return call.class === 'low-level' || call.class === 'unresolved' || call.class === 'resolved';
}
