/**
 * solidity-lite — a small, dependency-free lexical toolkit shared by the
 * cross-domain / oracle / signature / gas security detectors.
 *
 * It is deliberately NOT a Solidity parser. It masks comments and string
 * literals, balances braces/parentheses and extracts contracts, functions,
 * parameters and mapping declarations well enough for conservative,
 * evidence-reporting heuristics. Every helper is pure and total: malformed
 * input yields diagnostics, never an exception.
 *
 * Supported input: Solidity source text for compiler versions 0.6 – 0.8.x
 * (named mapping parameters from 0.8.18 are tolerated). Compiler settings are
 * not consulted; the toolkit never executes project scripts or reads project
 * configuration.
 */

export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type Confidence = 'low' | 'medium' | 'high';

/** Normalized finding produced by every detector built on this toolkit. */
export interface SecurityFinding {
  /** Stable rule identifier, e.g. `GG-XCHAIN-REPLAY-001`. */
  ruleId: string;
  /** Stable sub-kind within the rule, e.g. `replay-scope-incomplete`. */
  kind: string;
  severity: Severity;
  confidence: Confidence;
  /** 1-based source location of the primary evidence. */
  line: number;
  column: number;
  contract?: string;
  function?: string;
  message: string;
  /** Why this severity was chosen. */
  severityRationale: string;
  /** Concrete observations the confidence rating rests on. */
  confidenceEvidence: string[];
  remediation: string;
  /** Rule-specific structured evidence. */
  details?: Record<string, unknown>;
}

export interface Diagnostic {
  level: 'warning' | 'error';
  code: string;
  message: string;
  line?: number;
}

export interface RuleResult {
  ruleId: string;
  /** false when the input could not be analyzed at all. */
  analyzed: boolean;
  findings: SecurityFinding[];
  diagnostics: Diagnostic[];
}

export const MAX_SOURCE_LENGTH = 1_000_000;

export interface PreparedSource {
  source: string;
  /** Same length/offsets as `source`; comments blanked, string bodies blanked. */
  masked: string;
}

/** Validate input and mask it. Returns diagnostics instead of throwing. */
export function prepareSource(
  input: unknown,
): { ok: true; prepared: PreparedSource; diagnostics: Diagnostic[] } | { ok: false; diagnostics: Diagnostic[] } {
  if (typeof input !== 'string') {
    return { ok: false, diagnostics: [{ level: 'error', code: 'invalid-input', message: 'Source must be a string.' }] };
  }
  if (input.trim().length === 0) {
    return { ok: false, diagnostics: [{ level: 'error', code: 'empty-input', message: 'Source is empty.' }] };
  }
  if (input.length > MAX_SOURCE_LENGTH) {
    return {
      ok: false,
      diagnostics: [
        {
          level: 'error',
          code: 'source-too-large',
          message: `Source exceeds ${MAX_SOURCE_LENGTH} characters; refusing to analyze.`,
        },
      ],
    };
  }
  const masked = maskCommentsAndStrings(input);
  const diagnostics: Diagnostic[] = [];
  if (!/\b(contract|library|interface)\s+[A-Za-z_$]/.test(masked)) {
    return {
      ok: false,
      diagnostics: [
        { level: 'error', code: 'no-contract', message: 'No contract, library or interface declaration found; input is not supported Solidity.' },
      ],
    };
  }
  if (!balanced(masked)) {
    diagnostics.push({
      level: 'warning',
      code: 'unbalanced-delimiters',
      message: 'Braces or parentheses are unbalanced; results may be incomplete.',
    });
  }
  return { ok: true, prepared: { source: input, masked }, diagnostics };
}

function balanced(masked: string): boolean {
  let brace = 0;
  let paren = 0;
  for (const c of masked) {
    if (c === '{') brace++;
    else if (c === '}') brace--;
    else if (c === '(') paren++;
    else if (c === ')') paren--;
    if (brace < 0 || paren < 0) return false;
  }
  return brace === 0 && paren === 0;
}

/** Blank comments and string-literal bodies (quotes kept) preserving offsets. */
export function maskCommentsAndStrings(code: string): string {
  const out = code.split('');
  const n = code.length;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };
  let i = 0;
  while (i < n) {
    const c = code[i];
    const two = code.slice(i, i + 2);
    if (two === '//') {
      const end = code.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (two === '/*') {
      const end = code.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === '"' || c === "'") {
      let k = i + 1;
      while (k < n && code[k] !== c && code[k] !== '\n') {
        if (code[k] === '\\') k++;
        k++;
      }
      blank(i + 1, Math.min(k, n));
      i = k + 1;
      continue;
    }
    i++;
  }
  return out.join('');
}

export function lineColumn(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let last = -1;
  const end = Math.min(offset, source.length);
  for (let i = 0; i < end; i++) {
    if (source[i] === '\n') {
      line++;
      last = i;
    }
  }
  return { line, column: end - last };
}

/** Index of the delimiter matching the one at `openIdx`, or -1. */
export function findMatching(text: string, openIdx: number, open = '{', close = '}'): number {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Split on `sep` ignoring separators nested in (), [] or {}. */
export function splitTopLevel(text: string, sep = ','): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === sep && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

export interface SolContract {
  kind: 'contract' | 'library' | 'interface';
  name: string;
  /** Offset of the opening brace. */
  open: number;
  /** Offset of the closing brace (end of text when unbalanced). */
  close: number;
  bases: string[];
}

export function extractContracts(masked: string, diagnostics: Diagnostic[] = []): SolContract[] {
  const out: SolContract[] = [];
  const re = /\b(?:abstract\s+)?(contract|library|interface)\s+([A-Za-z_$][\w$]*)([^{;]*)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = findMatching(masked, open);
    const bases = /\bis\b([^{]*)/.exec(m[3])?.[1]?.split(',').map((b) => b.trim().replace(/\(.*$/, '')).filter(Boolean) ?? [];
    if (close === -1) {
      diagnostics.push({ level: 'warning', code: 'unterminated-contract', message: `Contract ${m[2]} has no closing brace.` });
      out.push({ kind: m[1] as SolContract['kind'], name: m[2], open, close: masked.length, bases });
      break;
    }
    out.push({ kind: m[1] as SolContract['kind'], name: m[2], open, close, bases });
    re.lastIndex = close + 1;
  }
  return out;
}

export function contractAt(contracts: SolContract[], offset: number): SolContract | undefined {
  let found: SolContract | undefined;
  for (const c of contracts) {
    if (offset > c.open && offset < c.close) found = c;
  }
  return found;
}

export interface SolParam {
  type: string;
  name: string;
  location: string;
}

export interface SolFunction {
  kind: 'function' | 'constructor' | 'fallback' | 'receive' | 'modifier';
  name: string;
  contract?: string;
  params: SolParam[];
  paramsText: string;
  header: string;
  visibility: 'public' | 'external' | 'internal' | 'private';
  mutability: 'view' | 'pure' | 'payable' | 'nonpayable';
  /** Modifier invocations in the header (names only). */
  modifiers: string[];
  returnsText: string;
  hasBody: boolean;
  body: string;
  /** Offset of the first character after the opening body brace. */
  bodyOffset: number;
  /** Offset of the `function` keyword. */
  offset: number;
  line: number;
}

const HEADER_KEYWORDS = new Set([
  'public', 'external', 'internal', 'private', 'view', 'pure', 'payable', 'nonpayable',
  'virtual', 'override', 'returns', 'constant',
]);

export function parseParams(text: string): SolParam[] {
  return splitTopLevel(text, ',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const toks = p.split(/\s+/);
      let location = '';
      const rest: string[] = [];
      for (const t of toks) {
        if (t === 'memory' || t === 'calldata' || t === 'storage') location = t;
        else rest.push(t);
      }
      let name = '';
      if (rest.length > 1 && rest[rest.length - 1] !== 'payable') {
        name = rest[rest.length - 1];
        rest.pop();
      }
      return { type: rest.join(' '), name, location };
    });
}

function parseHeader(header: string): Pick<SolFunction, 'visibility' | 'mutability' | 'modifiers' | 'returnsText'> {
  const returnsMatch = /\breturns\s*\(/.exec(header);
  let returnsText = '';
  let head = header;
  if (returnsMatch) {
    const open = returnsMatch.index + returnsMatch[0].length - 1;
    const close = findMatching(header, open, '(', ')');
    returnsText = header.slice(open + 1, close === -1 ? header.length : close);
    head = header.slice(0, returnsMatch.index) + ' ' + (close === -1 ? '' : header.slice(close + 1));
  }
  const visibility = (/\b(public|external|internal|private)\b/.exec(head)?.[1] ?? 'public') as SolFunction['visibility'];
  const mutability = (/\b(view|pure|payable)\b/.exec(head)?.[1] ?? 'nonpayable') as SolFunction['mutability'];
  const withoutOverride = head.replace(/\boverride\s*\([^)]*\)/g, ' ');
  const modifiers: string[] = [];
  const re = /([A-Za-z_$][\w$]*)\s*(\([^)]*\))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(withoutOverride)) !== null) {
    if (!HEADER_KEYWORDS.has(m[1])) modifiers.push(m[1]);
  }
  return { visibility, mutability, modifiers, returnsText };
}

export function extractFunctions(
  masked: string,
  source: string = masked,
  contracts: SolContract[] = extractContracts(masked),
  diagnostics: Diagnostic[] = [],
): SolFunction[] {
  const out: SolFunction[] = [];
  const re = /\b(function\s+([A-Za-z_$][\w$]*)|modifier\s+([A-Za-z_$][\w$]*)|constructor|fallback|receive)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const openParen = m.index + m[0].length - 1;
    const closeParen = findMatching(masked, openParen, '(', ')');
    if (closeParen === -1) {
      diagnostics.push({ level: 'warning', code: 'unbalanced-parameters', message: 'Unterminated parameter list.', line: lineColumn(source, m.index).line });
      break;
    }
    let p = closeParen + 1;
    let depth = 0;
    while (p < masked.length) {
      const c = masked[p];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (depth === 0 && (c === '{' || c === ';')) break;
      p++;
    }
    if (p >= masked.length) {
      diagnostics.push({ level: 'warning', code: 'missing-body', message: 'Function header is not terminated.', line: lineColumn(source, m.index).line });
      break;
    }
    const kind: SolFunction['kind'] = m[2]
      ? 'function'
      : m[3]
        ? 'modifier'
        : (m[1] as 'constructor' | 'fallback' | 'receive');
    const header = masked.slice(closeParen + 1, p);
    const base = {
      kind,
      name: m[2] ?? m[3] ?? m[1],
      contract: contractAt(contracts, m.index)?.name,
      params: parseParams(masked.slice(openParen + 1, closeParen)),
      paramsText: masked.slice(openParen + 1, closeParen),
      header,
      offset: m.index,
      line: lineColumn(source, m.index).line,
      ...parseHeader(header),
    };
    if (masked[p] === ';') {
      out.push({ ...base, hasBody: false, body: '', bodyOffset: p });
      re.lastIndex = p + 1;
      continue;
    }
    const close = findMatching(masked, p);
    if (close === -1) {
      diagnostics.push({ level: 'warning', code: 'unbalanced-braces', message: `Function ${base.name} has no closing brace.`, line: base.line });
      out.push({ ...base, hasBody: true, body: masked.slice(p + 1), bodyOffset: p + 1 });
      break;
    }
    out.push({ ...base, hasBody: true, body: masked.slice(p + 1, close), bodyOffset: p + 1 });
    re.lastIndex = close + 1;
  }
  return out;
}

export interface SolMapping {
  name: string;
  keyTypes: string[];
  valueType: string;
  contract?: string;
  offset: number;
  line: number;
}

export function extractMappings(
  masked: string,
  source: string = masked,
  contracts: SolContract[] = extractContracts(masked),
): SolMapping[] {
  const out: SolMapping[] = [];
  const re = /\bmapping\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = findMatching(masked, open, '(', ')');
    if (close === -1) break;
    const semi = masked.indexOf(';', close);
    if (semi === -1) break;
    const tail = masked.slice(close + 1, semi).replace(/=.*$/s, '');
    const name = /([A-Za-z_$][\w$]*)\s*$/.exec(tail.trim())?.[1];
    if (!name) {
      re.lastIndex = close + 1;
      continue;
    }
    const flat = masked.slice(open + 1, close).replace(/mapping\s*\(/g, '').replace(/\)/g, '');
    const segs = flat.split('=>').map((s) => s.trim());
    const clean = (s: string) => s.split(/\s+/)[0];
    out.push({
      name,
      keyTypes: segs.slice(0, -1).map(clean),
      valueType: clean(segs[segs.length - 1]),
      contract: contractAt(contracts, m.index)?.name,
      offset: m.index,
      line: lineColumn(source, m.index).line,
    });
    re.lastIndex = close + 1;
  }
  return out;
}

export interface SolStateVar {
  name: string;
  type: string;
  contract: string;
  constant: boolean;
  immutable: boolean;
  initializer: string;
  offset: number;
  line: number;
}

const NON_VARIABLE_START =
  /^(using|event|error|struct|enum|import|pragma|function|modifier|constructor|emit|receive|fallback|return)\b/;

/** Contract-level variable declarations (depth-1 statements ending in `;`). */
export function extractStateVars(
  masked: string,
  source: string = masked,
  contracts: SolContract[] = extractContracts(masked),
): SolStateVar[] {
  const out: SolStateVar[] = [];
  for (const c of contracts) {
    if (c.kind === 'interface') continue;
    let depth = 0;
    let segStart = c.open + 1;
    for (let i = c.open + 1; i < Math.min(c.close, masked.length); i++) {
      const ch = masked[i];
      if (ch === '{' || ch === '(' || ch === '[') depth++;
      else if (ch === '}' || ch === ')' || ch === ']') {
        depth--;
        if (depth === 0 && ch === '}') segStart = i + 1;
      } else if (ch === ';' && depth === 0) {
        const raw = masked.slice(segStart, i);
        const text = raw.trim();
        segStart = i + 1;
        if (!text || NON_VARIABLE_START.test(text)) continue;
        const eq = text.search(/=(?![=>])/);
        const decl = (eq === -1 ? text : text.slice(0, eq)).trim();
        const initializer = eq === -1 ? '' : text.slice(eq + 1).trim();
        const name = /([A-Za-z_$][\w$]*)$/.exec(decl)?.[1];
        if (!name || !/\s/.test(decl)) continue;
        const type = decl
          .slice(0, decl.length - name.length)
          .replace(/\b(public|private|internal|constant|immutable|override|transient)\b/g, ' ')
          .trim();
        const offset = segStart - 1 - raw.length + (raw.length - raw.trimStart().length);
        out.push({
          name,
          type,
          contract: c.name,
          constant: /\bconstant\b/.test(decl),
          immutable: /\bimmutable\b/.test(decl),
          initializer,
          offset,
          line: lineColumn(source, offset).line,
        });
      }
    }
  }
  return out;
}

/** True when `name` occurs as a whole identifier in `text`. */
export function mentions(text: string, name: string): boolean {
  if (!name) return false;
  return new RegExp(`(?<![\\w$.])${name.replace(/[$]/g, '\\$')}(?![\\w$])`).test(text);
}

/** Convenience: assemble a finding with location computed from an offset. */
export function makeFinding(
  source: string,
  offset: number,
  base: Omit<SecurityFinding, 'line' | 'column'>,
): SecurityFinding {
  const { line, column } = lineColumn(source, offset);
  return { ...base, line, column };
}

/** Known cross-domain receiver entry points (configurable per rule). */
export const DEFAULT_RECEIVER_NAMES = [
  'lzReceive', '_lzReceive', 'ccipReceive', '_ccipReceive', 'handle', 'receiveWormholeMessages',
  'executeMessage', 'onMessageReceived', 'onReceive', 'receiveMessage', 'processMessage',
  'relayMessage', 'finalizeMessage', 'finalizeWithdrawal', 'onOFTReceived', 'xReceive', 'receivePayload',
];

export function isReceiverName(name: string, extra: string[] = []): boolean {
  return [...DEFAULT_RECEIVER_NAMES, ...extra].includes(name);
}

const HANDLER_NAME_RE = /(receive|handle|execute|process|relay|finalize|deliver|complete|redeem|claim|onMessage)/i;

/**
 * Is this function a cross-domain message entry point? Known framework names
 * match at any visibility; otherwise the function must be public/external,
 * take a `bytes` payload/message parameter and have a handler-like name.
 */
export function isMessageReceiver(fn: SolFunction, extraNames: string[] = []): boolean {
  if (fn.kind !== 'function' || !fn.hasBody) return false;
  if (isReceiverName(fn.name, extraNames)) return true;
  if (fn.visibility !== 'public' && fn.visibility !== 'external') return false;
  const hasPayload = fn.params.some((p) => /bytes/.test(p.type) && /(payload|message|msg|data|body)/i.test(p.name));
  return hasPayload && HANDLER_NAME_RE.test(fn.name);
}

/* ------------------------------------------------------------------ */
/* Shared receiver / authentication / effect helpers                   */
/* ------------------------------------------------------------------ */

export interface Statement {
  text: string;
  /** Offset of the statement's first character in the original source. */
  offset: number;
  line: number;
}

const OPTIONS_BRACE_RE = /(\.\s*[A-Za-z_$][\w$]*|\bnew\s+[A-Za-z_$][\w$.]*)\s*$/;

/** Split a function body into coarse statements (on `;`, `{` and `}`; call-option braces are kept). */
export function statementsOf(fn: SolFunction, source: string = ''): Statement[] {
  const out: Statement[] = [];
  const body = fn.body;
  let depth = 0;
  let start = 0;
  const push = (end: number) => {
    const raw = body.slice(start, end);
    const text = raw.trim();
    if (!text) return;
    const offset = fn.bodyOffset + start + (raw.length - raw.trimStart().length);
    out.push({ text, offset, line: source ? lineColumn(source, offset).line : fn.line });
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && c === '{' && OPTIONS_BRACE_RE.test(body.slice(Math.max(start, i - 80), i))) {
      // Call options (`x.call{value: v, gas: g}(...)`, `new C{salt: s}(...)`) stay inside the statement.
      const close = findMatching(body, i);
      if (close !== -1) i = close;
    } else if (depth === 0 && (c === ';' || c === '{' || c === '}')) {
      push(i);
      start = i + 1;
    }
  }
  push(body.length);
  return out;
}

export const ENDPOINT_NAME_RE =
  /(endpoint|router|bridge|relayer|mailbox|gateway|messenger|portal|wormhole|ccip|layerzero|\blz\b|inbox|axelar|hyperlane|xdomain)/i;
const ENDPOINT_MODIFIER_RE = /^only(Endpoint|Router|Bridge|Mailbox|Gateway|Messenger|Relayer|CCIP|LayerZero|Inbox|Portal|Hyperlane|Wormhole|Axelar|Transport)/i;

export function modifierBodies(functions: SolFunction[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of functions) if (f.kind === 'modifier') map.set(f.name, f.body);
  return map;
}

/** Collect `msg.sender == X` / `X == msg.sender` comparands in a code block. */
export function msgSenderComparands(code: string): string[] {
  const out: string[] = [];
  const a = /msg\.sender\s*[!=]=\s*(?:address\s*\(\s*)?([A-Za-z_$][\w$.]*(?:\(\))?)/g;
  const b = /(?:address\s*\(\s*)?([A-Za-z_$][\w$.]*(?:\(\))?)\s*\)?\s*[!=]=\s*msg\.sender/g;
  let m: RegExpExecArray | null;
  while ((m = a.exec(code)) !== null) out.push(m[1]);
  while ((m = b.exec(code)) !== null) out.push(m[1]);
  return out;
}

/**
 * Does the function authenticate the transport (messaging endpoint / router /
 * bridge) that delivers the message? Inspects the function body, applied
 * modifiers and modifier bodies defined in the same source. Names are matched
 * heuristically and are never assumed trustworthy by themselves: this only
 * establishes that the caller is compared with a stored endpoint-like address.
 */
export function endpointAuthentication(
  fn: SolFunction,
  modifiers: Map<string, string>,
  extraNames: string[] = [],
): { authenticated: boolean; evidence: string[] } {
  const evidence: string[] = [];
  const isEndpoint = (name: string) =>
    ENDPOINT_NAME_RE.test(name) || extraNames.some((n) => name.toLowerCase().includes(n.toLowerCase()));
  for (const m of fn.modifiers) {
    if (ENDPOINT_MODIFIER_RE.test(m)) evidence.push(`modifier ${m}`);
    else if (modifiers.has(m) && msgSenderComparands(modifiers.get(m)!).some(isEndpoint)) {
      evidence.push(`modifier ${m} compares msg.sender with an endpoint-like address`);
    }
  }
  for (const c of msgSenderComparands(fn.body)) {
    if (isEndpoint(c)) evidence.push(`msg.sender compared with ${c}`);
  }
  return { authenticated: evidence.length > 0, evidence };
}

export interface Effect {
  kind: 'value-transfer' | 'state-write';
  statement: Statement;
}

const VALUE_RE =
  /(\b_?(mint|burn|transfer|transferFrom|safeTransfer|safeTransferFrom|release|unlock|withdraw|credit|swap|borrow|liquidate)\w*\s*\(|\.call\s*[({]|\.delegatecall\s*\(|\.send\s*\(|\bselfdestruct\s*\()/;
const ASSIGN_ROOT_RE = /^\s*([A-Za-z_$][\w$]*)(?:\s*\.\s*[A-Za-z_$][\w$]*|\s*\[[^\]]*\])*\s*(?:[-+*/|&^]|<<|>>)?=(?!=)/;

/** Statements that move value or write contract state. */
export function findEffects(fn: SolFunction, stateNames: Set<string>, source: string = ''): Effect[] {
  const out: Effect[] = [];
  for (const st of statementsOf(fn, source)) {
    if (VALUE_RE.test(st.text)) {
      out.push({ kind: 'value-transfer', statement: st });
      continue;
    }
    const root = ASSIGN_ROOT_RE.exec(st.text)?.[1];
    if (root && stateNames.has(root)) out.push({ kind: 'state-write', statement: st });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Oracle reads                                                        */
/* ------------------------------------------------------------------ */

export interface OracleRead {
  /** Receiver expression of the call, e.g. `priceFeed` or `feeds[token]`. */
  feed: string;
  method: string;
  statement: Statement;
  /** Offset of the call in the original source. */
  offset: number;
  /** Named tuple elements of a latestRoundData-style call. */
  roundData: {
    roundId?: string;
    answer?: string;
    startedAt?: string;
    updatedAt?: string;
    answeredInRound?: string;
  };
  /** Variable receiving a single-value price call. */
  resultVar?: string;
}

const ORACLE_METHOD_RE =
  /([A-Za-z_$][\w$]*(?:\s*\[[^\]]*\])?(?:\s*\.\s*[A-Za-z_$][\w$]*)*|\))\s*\.\s*(latestRoundData|latestAnswer|getRoundData|getPrice\w*|getAssetPrice|fetchPrice|getUnderlyingPrice|consult|peek|latestPrice|getLatestPrice|queryPrice)\s*\(/g;

const ROUND_DATA_FIELDS = ['roundId', 'answer', 'startedAt', 'updatedAt', 'answeredInRound'] as const;

/** Price-oracle reads in a function: Chainlink-style aggregators and custom adapters. */
export function findOracleReads(fn: SolFunction, source: string = '', extraMethods: string[] = []): OracleRead[] {
  const out: OracleRead[] = [];
  const statements = statementsOf(fn, source);
  const extra = extraMethods.length
    ? new RegExp(`([A-Za-z_$][\\w$]*(?:\\s*\\[[^\\]]*\\])?(?:\\s*\\.\\s*[A-Za-z_$][\\w$]*)*)\\s*\\.\\s*(${extraMethods.join('|')})\\s*\\(`, 'g')
    : undefined;
  for (const st of statements) {
    const regexes = [ORACLE_METHOD_RE, ...(extra ? [extra] : [])];
    for (const re of regexes) {
      re.lastIndex = 0;
      const m = re.exec(st.text);
      if (!m) continue;
      const method = m[2];
      const roundData: OracleRead['roundData'] = {};
      let resultVar: string | undefined;
      const eq = st.text.search(/[^=!<>]=(?!=)/);
      const lhs = eq === -1 ? '' : st.text.slice(0, eq + 1).trim();
      if (lhs.startsWith('(')) {
        splitTopLevel(lhs.slice(1, lhs.lastIndexOf(')'))).forEach((part, i) => {
          const name = /([A-Za-z_$][\w$]*)\s*$/.exec(part.trim())?.[1];
          if (name && /\s/.test(part.trim()) && i < ROUND_DATA_FIELDS.length) roundData[ROUND_DATA_FIELDS[i]] = name;
        });
      } else if (lhs && /\s/.test(lhs)) {
        resultVar = /([A-Za-z_$][\w$]*)$/.exec(lhs)?.[1];
      } else if (lhs) {
        resultVar = lhs;
      }
      out.push({ feed: m[1].replace(/\s+/g, ''), method, statement: st, offset: st.offset + m.index, roundData, resultVar });
      break;
    }
  }
  return out;
}
