/**
 * solidity-inheritance — resolves inheritance for the lexical detectors built on solidity-lite.
 *
 * For every contract defined in the analyzed source it computes a linearization (most derived
 * first, approximating Solidity's C3 order), the effective function set after overrides, the
 * effective modifier set (a derived `virtual` modifier replaces the base one) and the visible
 * state variables. It also resolves internal calls, including `super.f()`, so detectors can follow
 * a call chain across functions and across base contracts.
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

function linearize(name: string, byName: Map<string, SolContract>, seen: Set<string> = new Set()): SolContract[] {
  const c = byName.get(name);
  if (!c || seen.has(name)) return [];
  seen.add(name);
  const out: SolContract[] = [c];
  // Solidity gives the right-most base the highest precedence after the contract itself.
  for (const base of [...c.bases].reverse()) {
    for (const b of linearize(base, byName, seen)) out.push(b);
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
    const linearization = linearize(c.name, byName);
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
