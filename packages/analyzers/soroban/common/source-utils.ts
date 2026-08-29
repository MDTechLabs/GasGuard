/**
 * Shared lexical helpers for the Soroban (Rust) source analyzers.
 *
 * These analyzers are lexical rather than AST-based, so the helpers here exist
 * to make the regex scanning safe: comments and string literals are masked out,
 * offsets map back to line numbers, and call arguments are extracted with
 * balanced-paren matching so multi-line call sites parse correctly.
 */

/** Kind of block a call site is nested inside. */
export type BlockKind = 'fn' | 'if' | 'else' | 'match' | 'loop' | 'block';

/** One enclosing block, identified by kind and the offset of its `{`. */
export interface BlockFrame {
  kind: BlockKind;
  /** Offset of the opening brace — distinguishes sibling blocks of one kind. */
  start: number;
}

export interface FunctionBlock {
  name: string;
  /** Offset of the `{` opening the body. */
  bodyStart: number;
  /** Offset just past the `}` closing the body. */
  bodyEnd: number;
  /** 1-based line of the `fn` keyword. */
  line: number;
}

/**
 * Replace the contents of comments and string/char literals with spaces.
 *
 * Offsets and line breaks are preserved, so the masked copy can be scanned with
 * regexes while indices still address the original source.
 */
export function maskNonCode(source: string): string {
  const out = source.split('');
  let i = 0;

  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };

  while (i < source.length) {
    const two = source.slice(i, i + 2);

    if (two === '//') {
      let end = source.indexOf('\n', i);
      if (end === -1) end = source.length;
      blank(i, end);
      i = end;
      continue;
    }

    if (two === '/*') {
      let depth = 1;
      let k = i + 2;
      while (k < source.length && depth > 0) {
        if (source.slice(k, k + 2) === '/*') {
          depth++;
          k += 2;
        } else if (source.slice(k, k + 2) === '*/') {
          depth--;
          k += 2;
        } else {
          k++;
        }
      }
      blank(i, k);
      i = k;
      continue;
    }

    if (source[i] === '"') {
      let k = i + 1;
      while (k < source.length) {
        if (source[k] === '\\') {
          k += 2;
          continue;
        }
        if (source[k] === '"') {
          k++;
          break;
        }
        k++;
      }
      blank(i, k);
      i = k;
      continue;
    }

    // Char literal — must not swallow Rust lifetimes such as `&'a str`.
    if (source[i] === "'" && /^'(?:\\.|[^\\'])'/.test(source.slice(i, i + 4))) {
      const end = source.indexOf("'", source[i + 1] === '\\' ? i + 3 : i + 2) + 1;
      blank(i, end);
      i = end;
      continue;
    }

    i++;
  }

  return out.join('');
}

/** Builds an offset → 1-based line resolver for a source string. */
export function createLineResolver(source: string): (offset: number) => number {
  const starts: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') starts.push(i + 1);
  }

  return (offset: number): number => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/**
 * Extract function bodies via brace counting on masked source.
 */
export function extractFunctions(masked: string, original: string): FunctionBlock[] {
  const blocks: FunctionBlock[] = [];
  const lineOf = createLineResolver(original);
  const fnRe = /\bfn\s+([A-Za-z_][A-Za-z0-9_]*)/g;

  let m: RegExpExecArray | null;
  while ((m = fnRe.exec(masked)) !== null) {
    const braceStart = findBodyStart(masked, m.index + m[0].length);
    if (braceStart === -1) continue;

    const bodyEnd = matchBrace(masked, braceStart);
    if (bodyEnd === -1) continue;

    blocks.push({
      name: m[1],
      bodyStart: braceStart,
      bodyEnd,
      line: lineOf(m.index),
    });
  }

  return blocks;
}

/** Finds the `{` that opens a function body, skipping the signature. */
function findBodyStart(masked: string, from: number): number {
  let depth = 0;
  for (let i = from; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ';' && depth === 0) return -1; // trait method, no body
    else if (ch === '{' && depth === 0) return i;
  }
  return -1;
}

/** Returns the offset just past the `}` matching the `{` at `open`. */
export function matchBrace(masked: string, open: number): number {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === '{') depth++;
    else if (masked[i] === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Extract the raw text between the `(` at `openParen` and its matching `)`.
 * Reads from `original` so argument text keeps string literals intact, but uses
 * `masked` to find the boundary so parens inside literals are ignored.
 */
export function extractArgs(
  masked: string,
  original: string,
  openParen: number,
): { text: string; end: number } {
  let depth = 0;
  for (let i = openParen; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        return { text: original.slice(openParen + 1, i), end: i + 1 };
      }
    }
  }
  return { text: original.slice(openParen + 1), end: masked.length };
}

/** Split an argument list on top-level commas. */
export function splitArgs(args: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';

  for (const ch of args) {
    if (ch === '(' || ch === '[' || ch === '<' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '>' || ch === '}') depth--;

    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }

  if (current.trim().length > 0) parts.push(current);
  return parts.map(normalizeExpr).filter((p) => p.length > 0);
}

/**
 * Normalize an expression so that syntactic noise does not defeat equality
 * checks: `&to.clone()`, `to.clone()` and `&to` all fingerprint as `to`.
 */
export function normalizeExpr(expr: string): string {
  return expr
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[&*]+\s*/, '')
    .replace(/(?:\.clone\(\))+$/, '')
    .replace(/\.into\(\)$/, '')
    .replace(/\.to_owned\(\)$/, '')
    .trim();
}

/**
 * Walk backwards from a `.method(` call to capture its receiver expression.
 */
export function receiverBefore(original: string, dotIndex: number): string {
  let depth = 0;
  let i = dotIndex - 1;

  while (i >= 0) {
    const ch = original[i];
    if (ch === ')' || ch === ']' || ch === '>') depth++;
    else if (ch === '(' || ch === '[' || ch === '<') {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0 && !/[A-Za-z0-9_.:&\s]/.test(ch)) {
      break;
    }
    i--;
  }

  return original.slice(i + 1, dotIndex).trim();
}

/**
 * Resolve `let <name> = token::Client::new(&env, &<token>)` bindings so a later
 * `<name>.transfer(..)` can be attributed to the token it was built from.
 *
 * Returns a map of binding name → normalized token expression.
 */
export function resolveTokenBindings(masked: string, original: string): Map<string, string> {
  const bindings = new Map<string, string>();
  const re = /\blet\s+(?:mut\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?::[^=;]+)?=\s*([A-Za-z_][A-Za-z0-9_:]*)\s*::\s*new\s*\(/g;

  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const ctor = m[2];
    if (!/client$/i.test(ctor.split('::').pop() ?? '') && !/token/i.test(ctor)) continue;

    const openParen = m.index + m[0].length - 1;
    const args = splitArgs(extractArgs(masked, original, openParen).text);
    // Convention: Client::new(&env, &token_address)
    const token = args.length >= 2 ? args[1] : args[0] ?? 'unknown';
    bindings.set(m[1], token);
  }

  return bindings;
}

/**
 * Resolve the token address a call receiver refers to.
 *
 * Handles both `client.transfer(..)` (via `bindings`) and the inline
 * `token::Client::new(&env, &usdc).transfer(..)` form.
 */
export function resolveTokenFromReceiver(
  receiver: string,
  bindings: Map<string, string>,
): string {
  const inline = receiver.match(/::\s*new\s*\(([^)]*)\)\s*$/);
  if (inline) {
    const args = splitArgs(inline[1]);
    return args.length >= 2 ? args[1] : args[0] ?? 'unknown';
  }

  const base = normalizeExpr(receiver).split('.')[0];
  return bindings.get(base) ?? (base.length > 0 ? base : 'unknown');
}

/**
 * Compute the stack of enclosing blocks for an offset inside a function body.
 * Each frame carries the offset of its opening brace so that two call sites in
 * *different* `if` blocks are distinguishable from two sites in the same one.
 */
export function blockStackAt(
  masked: string,
  bodyStart: number,
  offset: number,
): BlockFrame[] {
  const stack: BlockFrame[] = [{ kind: 'fn', start: bodyStart }];

  for (let i = bodyStart + 1; i < offset && i < masked.length; i++) {
    const ch = masked[i];
    if (ch === '{') {
      stack.push({
        kind: classifyBlock(masked.slice(Math.max(bodyStart, i - 160), i)),
        start: i,
      });
    } else if (ch === '}') {
      if (stack.length > 1) stack.pop();
    }
  }

  return stack;
}

function classifyBlock(preceding: string): BlockKind {
  if (/=>\s*$/.test(preceding)) return 'match';
  const m = preceding.match(/\b(if|else|for|while|loop|match)\b[^{};]*$/);
  if (!m) return 'block';
  switch (m[1]) {
    case 'if':
      return 'if';
    case 'else':
      return 'else';
    case 'match':
      return 'match';
    default:
      return 'loop';
  }
}

const BRANCH_KINDS: ReadonlySet<BlockKind> = new Set<BlockKind>(['if', 'else', 'match']);

/** True when the call site sits inside a loop body. */
export function isInLoop(stack: BlockFrame[]): boolean {
  return stack.some((f) => f.kind === 'loop');
}

/** True when the call site sits inside a conditional branch or match arm. */
export function isInBranch(stack: BlockFrame[]): boolean {
  return stack.some((f) => BRANCH_KINDS.has(f.kind));
}

/**
 * True when two call sites cannot be assumed to both execute, in order, on
 * every run — they live in different branches, or one is guarded by a
 * conditional the other is not. Consolidating across such sites is unsafe.
 */
export function onExclusiveBranches(a: BlockFrame[], b: BlockFrame[]): boolean {
  const len = Math.min(a.length, b.length);

  for (let i = 0; i < len; i++) {
    if (a[i].start !== b[i].start) {
      // Diverged: exclusive if either path enters a branch at or below here.
      return (
        a.slice(i).some((f) => BRANCH_KINDS.has(f.kind)) ||
        b.slice(i).some((f) => BRANCH_KINDS.has(f.kind))
      );
    }
  }

  // One stack is a prefix of the other: the deeper site is conditionally
  // executed if any of its extra frames is a branch.
  const deeper = a.length >= b.length ? a : b;
  return deeper.slice(len).some((f) => BRANCH_KINDS.has(f.kind));
}
