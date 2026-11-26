/**
 * GG-PAUSE-BYPASS-001 — Privileged and sensitive functions that bypass pause enforcement.
 *
 * For every concrete (leaf) contract that has a pause mechanism, the rule builds an inventory of
 * pause-sensitive entry points (deposit / withdraw / mint / swap / claim ... by name, plus any
 * function that moves value or writes balance-like state) and checks that each one is covered by a
 * pause check: a `whenNotPaused`-style modifier (resolved through inherited and overridden
 * modifiers), an inline `require(!paused)` / `_requireNotPaused()`, or a guarded function on every
 * call path to the sensitive effect (so an unguarded sibling of a guarded entry point is caught).
 * Callbacks (token hooks, flash-loan / swap callbacks, cross-chain receivers, receive/fallback)
 * are treated as entry points too.
 *
 * Not every function must be paused. Exempt: pause control, `emergency*` paths, functions that are
 * only callable while paused, `exemptFunctions` / `exemptPatterns` options, and functions with a
 * documented annotation in the comment above them: `// gasguard-pause-exempt: <reason>` or
 * `@custom:pause-exempt <reason>`.
 *
 * Supported: Solidity 0.6 - 0.8.x, single source string. Bases not defined in the source are not
 * visible (a `Pausable`-style base is recognised by name only). Guards are matched textually and
 * are not checked for dominating the effect. Options are validated; no project scripts or
 * configuration are executed. See docs/rules/pause-enforcement-bypass.md.
 */
import {
  Diagnostic,
  RuleResult,
  SecurityFinding,
  SolFunction,
  DEFAULT_RECEIVER_NAMES,
  findEffects,
  makeFinding,
  msgSenderComparands,
  prepareSource,
} from '../lib/solidity-lite';
import { leadingComment, buildSourceModel, calleesOf, formatModifierOrder, isWellKnownBase, modifierExecutionOrder, signatureOf } from '../lib/solidity-inheritance';

export const RULE_ID = 'GG-PAUSE-BYPASS-001';

export interface PauseBypassOptions {
  /** Extra sensitive operation categories: `namePattern` is a regular-expression source. */
  operations?: { category: string; namePattern: string }[];
  /** Function names that are intentionally callable while paused. */
  exemptFunctions?: string[];
  /** Regular-expression sources for exempt function names. */
  exemptPatterns?: string[];
  /** Extra modifier names that enforce the pause. */
  pauseModifiers?: string[];
  /** Extra state-variable names that hold the pause flag. */
  pauseVariables?: string[];
  /** Extra callback function names. */
  callbackNames?: string[];
  /** Report owner/role-gated functions too (default true). */
  includePrivileged?: boolean;
}

export interface PauseInventoryEntry {
  contract: string;
  function: string;
  definedIn: string;
  line: number;
  category: string;
  privileged: boolean;
  callback: boolean;
  status: 'enforced' | 'missing' | 'exempt';
  guard?: string;
  exemption?: string;
  path?: string[];
}

export interface PauseBypassResult extends RuleResult {
  inventory: PauseInventoryEntry[];
}

const DEFAULT_OPERATIONS: [string, RegExp][] = [
  ['deposit', /^_?(deposit|stake|supply|lock|addLiquidity|contribute|fund)/i],
  ['withdraw', /^_?(withdraw|unstake|redeem|removeLiquidity|unlock|cashOut)/i],
  ['mint-burn', /^_?(mint|burn)/i],
  ['lending', /^_?(borrow|repay|liquidate|flashLoan)/i],
  ['swap', /^_?(swap|exchange|trade|buy|sell)/i],
  ['claim', /^_?(claim|harvest|collect|payout|distribute|release)/i],
  ['transfer', /^_?(transfer|transferFrom|send)$/i],
  ['bridge', /^_?(bridge|relay|finalize)/i],
];

const CALLBACKS = new Set([
  'onERC721Received', 'onERC1155Received', 'onERC1155BatchReceived', 'tokensReceived', 'tokensToSend',
  'onTokenTransfer', 'onFlashLoan', 'executeOperation', 'receiveFlashLoan', 'uniswapV3SwapCallback',
  'uniswapV3FlashCallback', 'uniswapV3MintCallback', 'uniswapV2Call', 'pancakeCall', ...DEFAULT_RECEIVER_NAMES,
]);

const PAUSE_VAR = '_?(?:is)?[Pp]aused|_?stopped|_?isStopped|emergencyStop(?:ped)?|_?frozen|_?halted|circuitBreaker\\w*|killSwitch\\w*';
const NOT_PAUSED_MOD = /^(?:only)?(?:when|if)(?:Not|Un)(?:Paused|Stopped|Frozen|Halted)$|^not(?:Paused|Stopped|Frozen)$|^when(?:Active|Running|Operational|Live)$|^stopInEmergency$/i;
const PAUSED_ONLY_MOD = /^(?:only)?when(?:Paused|Stopped|Frozen|Halted)$|^onlyInEmergency$|^onlyPaused$/i;
const PAUSE_HELPER = /\b(?:_requireNotPaused|_whenNotPaused|_checkNotPaused|requireNotPaused|_notPaused|_ensureNotPaused|_revertIfPaused)\s*\(/;
const PRIVILEGE_MOD = /^(?:only[A-Z]\w*|auth|requiresAuth|restricted|isOwner)$/;
const NOT_PRIVILEGE_MOD = /^(?:onlyInitializing|onlyProxy|onlyDelegateCall)$/;
const DEFAULT_EXEMPT = /^_?(?:un)?pause$|^_?emergency|^_?rescue/i;
const SENSITIVE_STATE = /(balance|share|debt|stake|deposit|collateral|reward|supply|liquidity|reserve|position|principal|escrow|claimable)/i;
const ANNOTATION = /gasguard-pause-exempt|@custom:pause-exempt/i;

/** Compiles an option-supplied regex source safely; rejects oversized or nested-quantifier patterns. */
function safeRegex(src: unknown, label: string, diagnostics: Diagnostic[]): RegExp | null {
  if (typeof src !== 'string' || src.length === 0 || src.length > 120 || /\([^)]*[+*][^)]*\)[+*{]/.test(src)) {
    diagnostics.push({ level: 'warning', code: 'invalid-option', message: `Ignored invalid ${label} pattern.` });
    return null;
  }
  try {
    return new RegExp(src, 'i');
  } catch {
    diagnostics.push({ level: 'warning', code: 'invalid-option', message: `Ignored invalid ${label} pattern.` });
    return null;
  }
}

function names(list: unknown, label: string, diagnostics: Diagnostic[]): string[] {
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.some((n) => typeof n !== 'string' || !/^[A-Za-z_$][\w$]*$/.test(n))) {
    diagnostics.push({ level: 'warning', code: 'invalid-option', message: `Ignored invalid ${label} list.` });
    return [];
  }
  return list as string[];
}

export function detectPauseBypass(input: unknown, options: PauseBypassOptions = {}): PauseBypassResult {
  const prep = prepareSource(input);
  if (!prep.ok) return { ruleId: RULE_ID, analyzed: false, findings: [], diagnostics: prep.diagnostics, inventory: [] };
  const { source, masked } = prep.prepared;
  const diagnostics: Diagnostic[] = [...prep.diagnostics];

  const ops = [...DEFAULT_OPERATIONS];
  for (const o of options.operations ?? []) {
    const re = o && typeof o.category === 'string' ? safeRegex(o.namePattern, 'operation', diagnostics) : null;
    if (re) ops.push([o.category, re]);
  }
  const exemptNames = new Set(names(options.exemptFunctions, 'exemptFunctions', diagnostics));
  const exemptRes = (options.exemptPatterns ?? []).map((p) => safeRegex(p, 'exemptPatterns', diagnostics)).filter((r): r is RegExp => !!r);
  const extraMods = new Set(names(options.pauseModifiers, 'pauseModifiers', diagnostics));
  const pauseVar = [PAUSE_VAR, ...names(options.pauseVariables, 'pauseVariables', diagnostics)].join('|');
  const callbacks = new Set([...CALLBACKS, ...names(options.callbackNames, 'callbackNames', diagnostics)]);
  const includePrivileged = options.includePrivileged !== false;

  const inlineGuardRes = [
    PAUSE_HELPER,
    new RegExp(`\\b(?:require|assert)\\s*\\(\\s*!\\s*(?:this\\.)?(?:${pauseVar})\\b\\s*(?:\\(\\s*\\))?`),
    new RegExp(`\\bif\\s*\\(\\s*(?:this\\.)?(?:${pauseVar})\\s*(?:\\(\\s*\\))?\\s*\\)\\s*(?:\\{\\s*)?(?:revert|return)\\b`),
    new RegExp(`\\brequire\\s*\\(\\s*(?:this\\.)?(?:${pauseVar})\\s*(?:\\(\\s*\\))?\\s*==\\s*false`),
  ];
  const requiresPausedRes = [
    new RegExp(`\\brequire\\s*\\(\\s*(?:this\\.)?(?:${pauseVar})\\s*(?:\\(\\s*\\))?\\s*[,)]`),
    new RegExp(`\\bif\\s*\\(\\s*!\\s*(?:this\\.)?(?:${pauseVar})\\s*(?:\\(\\s*\\))?\\s*\\)\\s*(?:\\{\\s*)?revert\\b`),
  ];
  const hasInline = (text: string) => inlineGuardRes.some((r) => r.test(text));

  const src = buildSourceModel(masked, source, diagnostics);
  const findings: SecurityFinding[] = [];
  const inventory: PauseInventoryEntry[] = [];

  for (const model of src.contracts.values()) {
    if (!model.isLeaf || model.contract.kind !== 'contract') continue;
    const unresolved = model.unresolvedBases;
    const unknown = unresolved.filter((b) => !isWellKnownBase(b));
    if (unknown.length > 0) {
      diagnostics.push({ level: 'warning', code: 'unresolved-base', message: `${model.contract.name}: base ${unknown.join(', ')} is not defined in this source; inherited entry points and modifiers are not visible.` });
    }

    const stateNames = new Set(model.stateVars.map((v) => v.name));
    const guardCache = new Map<SolFunction, string | null>();
    const guardOf = (fn: SolFunction): string | null => {
      if (guardCache.has(fn)) return guardCache.get(fn)!;
      let ev: string | null = null;
      for (const m of fn.modifiers) {
        const body = model.modifiers.get(m);
        if (body) {
          if (hasInline(body.body)) ev = `modifier ${m}`;
        } else if (NOT_PAUSED_MOD.test(m) || extraMods.has(m)) {
          ev = `modifier ${m} (inherited; body not visible)`;
        }
        if (ev) break;
      }
      if (!ev && hasInline(fn.body)) ev = 'inline pause check';
      guardCache.set(fn, ev);
      return ev;
    };
    const requiresPaused = (fn: SolFunction) =>
      fn.modifiers.some((m) => PAUSED_ONLY_MOD.test(m) || (model.modifiers.get(m) && requiresPausedRes.some((r) => r.test(model.modifiers.get(m)!.body)))) ||
      requiresPausedRes.some((r) => r.test(fn.body));

    // ERC20Pausable-style hooks pause every internal _mint/_burn/_transfer.
    const hooksGuarded =
      model.linearization.some((c) => c.bases.some((b) => /^ERC\d+Pausable/.test(b))) ||
      model.functions.some((f) => /^_(before|after)TokenTransfers?$|^_update$/.test(f.name) && guardOf(f));
    const pausable =
      unresolved.some((b) => /Pausable/.test(b)) ||
      model.stateVars.some((v) => new RegExp(`^(?:${pauseVar})$`).test(v.name)) ||
      model.functions.some((f) => /^_?(un)?pause$/i.test(f.name) || guardOf(f));
    if (!pausable) continue;

    const categoryOf = (fn: SolFunction) => ops.find(([, re]) => re.test(fn.name))?.[0];
    const ownEffect = (fn: SolFunction, anyWrite: boolean): { kind: string; line: number } | null => {
      for (const e of findEffects(fn, stateNames, source)) {
        const text = e.statement.text;
        if (e.kind === 'value-transfer') {
          if (hooksGuarded && /^(?:[\w.\s]*=\s*)?_(?:mint|burn|transfer|safeMint|update)\w*\s*\(/.test(text)) continue;
          return { kind: 'value-transfer', line: e.statement.line };
        }
        const root = /^\s*([A-Za-z_$][\w$]*)/.exec(text)?.[1] ?? '';
        if (SENSITIVE_STATE.test(root)) return { kind: 'sensitive-state-write', line: e.statement.line };
        if (anyWrite) return { kind: 'state-write', line: e.statement.line };
      }
      return null;
    };
    const isCallback = (fn: SolFunction) => fn.kind === 'receive' || fn.kind === 'fallback' || callbacks.has(fn.name);
    const exemptionOf = (fn: SolFunction): string | undefined => {
      const note = ANNOTATION.exec(leadingComment(source, fn.offset));
      if (note) return 'documented annotation';
      if (exemptNames.has(fn.name) || exemptRes.some((r) => r.test(fn.name))) return 'configured exemption';
      if (DEFAULT_EXEMPT.test(fn.name)) return 'pause control or emergency path';
      if (requiresPaused(fn)) return 'only callable while paused';
      return undefined;
    };
    const isPrivileged = (fn: SolFunction): boolean => {
      if (fn.modifiers.some((m) => !NOT_PRIVILEGE_MOD.test(m) && (PRIVILEGE_MOD.test(m) || /\bonlyRole\b/.test(m) || /msg\.sender\s*[!=]=|hasRole|_checkRole|_checkOwner/.test(model.modifiers.get(m)?.body ?? '')))) return true;
      const params = new Set(fn.params.map((p) => p.name));
      return msgSenderComparands(fn.body).some((c) => !params.has(c)) || /\b(?:_checkOwner|_checkRole|_onlyOwner|hasRole)\s*\(/.test(fn.body);
    };

    type Cov = { sink: SolFunction; kind: string; line: number; path: SolFunction[] } | null;
    const coverage = (fn: SolFunction, anyWrite: boolean, stack: SolFunction[] = []): Cov => {
      if (stack.includes(fn) || guardOf(fn) || exemptionOf(fn)) return null;
      const own = categoryOf(fn) ? ownEffect(fn, true) ?? { kind: 'named-operation', line: fn.line } : ownEffect(fn, anyWrite);
      if (own) return { sink: fn, kind: own.kind, line: own.line, path: [fn] };
      for (const callee of calleesOf(model, fn)) {
        const r = coverage(callee, false, [...stack, fn]);
        if (r) return { ...r, path: [fn, ...r.path] };
      }
      return null;
    };
    const reaches = (from: SolFunction, target: SolFunction, seen: SolFunction[] = []): boolean =>
      from === target || (!seen.includes(from) && calleesOf(model, from).some((c) => reaches(c, target, [...seen, from])));

    const entries = model.functions.filter((f) => (f.kind === 'function' ? (f.visibility === 'public' || f.visibility === 'external') && f.mutability !== 'view' && f.mutability !== 'pure' : true));
    for (const fn of entries) {
      const callback = isCallback(fn);
      const cov = coverage(fn, callback);
      const guard = guardOf(fn);
      const exemption = exemptionOf(fn);
      const category = categoryOf(fn) ?? (callback ? 'callback' : cov?.kind ?? 'sensitive-effect');
      if (!cov && !guard && !exemption) continue; // nothing sensitive reached
      const privileged = isPrivileged(fn);
      const entry: PauseInventoryEntry = {
        contract: model.contract.name, function: fn.name, definedIn: fn.contract ?? model.contract.name, line: fn.line,
        category, privileged, callback, status: exemption ? 'exempt' : cov ? 'missing' : 'enforced',
        guard: guard ?? undefined, exemption, path: cov?.path.map((f) => f.name),
      };
      inventory.push(entry);
      if (!cov || exemption) continue;
      if (privileged && !includePrivileged) continue;

      const inherited = fn.contract !== model.contract.name;
      const crossFunction = cov.path.length > 1;
      const kind = callback ? 'callback-bypasses-pause' : privileged ? 'privileged-operation-unpaused' : crossFunction ? 'cross-function-pause-gap' : inherited ? 'inherited-entry-point-unpaused' : 'unpaused-entry-point';
      const siblings = entries.filter((e) => e !== fn && guardOf(e) && reaches(e, cov.sink)).map((e) => e.name);
      const moves = cov.kind === 'value-transfer' || /^(withdraw|mint-burn|lending|claim|swap|transfer|bridge)$/.test(category);
      const severity: SecurityFinding['severity'] = callback ? 'medium' : privileged ? (moves ? 'medium' : 'low') : 'high';
      const confidence: SecurityFinding['confidence'] = privileged || (callback && cov.kind === 'state-write') ? 'low' : siblings.length > 0 ? 'high' : unknown.length > 0 ? 'low' : 'medium';
      const via = crossFunction ? ` through ${cov.path.slice(1).map((f) => f.name + '()').join(' -> ')}` : '';
      findings.push(
        makeFinding(source, fn.offset, {
          ruleId: RULE_ID, kind, severity, confidence, contract: model.contract.name, function: fn.name,
          message: `${fn.name}() [${category}] stays callable while ${model.contract.name} is paused${via}${inherited ? ` (inherited from ${fn.contract})` : ''}.`,
          severityRationale: callback
            ? 'Callbacks run in the middle of other protocols\' transactions and can change accounting while the protocol is paused; severity medium.'
            : privileged
              ? 'Only a privileged caller can reach it, and admin actions during a pause can be intentional; severity ' + severity + '.'
              : 'Any caller can move value or change accounting while the pause is supposed to stop it, defeating the emergency control; severity high.',
          confidenceEvidence: [
            `no pause modifier or inline pause check on ${fn.name}()`,
            `${cov.kind} at line ${cov.line} (${cov.sink.name}())`,
            ...(siblings.length ? [`${siblings.join(', ')}() reach the same code under a pause guard, so the pause was intended to cover it`] : []),
            ...(unknown.length ? [`bases not visible: ${unknown.join(', ')}`] : []),
          ],
          remediation: `Add a pause guard to ${fn.name}() (or to ${cov.sink.name}()), or document the exemption with "// gasguard-pause-exempt: <reason>" if it must work while paused.`,
          details: { category, privileged, inherited, definedIn: fn.contract, path: cov.path.map((f) => `${f.name}:${f.line}`), guardedSiblings: siblings, signature: signatureOf(fn), modifierOrder: formatModifierOrder(modifierExecutionOrder(model, fn)) },
        }),
      );
    }
  }
  return { ruleId: RULE_ID, analyzed: true, findings, diagnostics, inventory };
}
