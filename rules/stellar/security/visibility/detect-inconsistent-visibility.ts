/**
 * Detect Inconsistent Soroban Function Visibility (#322)
 *
 * Soroban treats every `pub fn` inside an `#[contractimpl]` impl block as an
 * externally invokable contract entry point. Each entry point inflates Wasm
 * size, increases dispatch cost, and broadens the contract attack surface.
 *
 * This rule flags functions whose visibility is inconsistent with their intent:
 *   1. `pub fn _xxx` — leading-underscore names are a Rust convention for
 *      intentionally unused or private items; marking one `pub` is a strong
 *      signal that the author meant it to be hidden.
 *   2. `pub fn` whose name suggests an internal helper
 *      (helper_, internal_, _inner, priv_, private_) — these were almost
 *      certainly meant to stay inside the contract.
 *   3. `pub fn` with one of those helper-style names that does not even
 *      receive `Env` as its first parameter cannot be a real Soroban entry
 *      point and is reported with `helper-no-env` to indicate the stronger
 *      confidence.
 *
 * Only the literal `pub` keyword is checked; `pub(crate)` and `pub(super)`
 * are ignored by the Soroban entry-point generator and are considered safe.
 */

export type VisibilityKind =
  | 'underscore-name'
  | 'helper-name'
  | 'helper-no-env';

export interface VisibilityViolation {
  functionName: string;
  line: number;
  visibility: 'pub';
  kind: VisibilityKind;
  reason: string;
}

export interface InconsistentVisibilityResult {
  detected: boolean;
  violations: VisibilityViolation[];
  functionsScanned: number;
  implementationsScanned: number;
  message: string;
  suggestion: string;
}

interface FnInfo {
  name: string;
  paramList: string;
  absIdx: number;
}

const CONTRACT_IMPL_ATTRIBUTE = /#\s*\[\s*contractimpl\b/;

// Tokens that strongly suggest an internal intent: matched when preceded by
// the start of the name or an underscore and followed by an underscore or
// end of name. `priv` is intentionally included as a token (so `priv_x` and
// `private_x` are caught) but it must be followed by `_` to avoid matching
// unrelated words like `privacy`.
const HELPER_TOKEN = /(?:^|_)(?:helper|internal|inner|priv|private)(?:_|$)/;

const REASON_MAP: Record<VisibilityKind, string> = {
  'underscore-name':
    'underscore-prefixed name suggests the function should be private',
  'helper-name':
    'name indicates a helper or internal utility but is exposed as a contract entry point',
  'helper-no-env':
    'helper-style function without an `Env` first parameter cannot be a real Soroban entry point',
};

// Locate the start and end brace range of an `impl { ... }` block whose
// preceding attribute is `#[contractimpl]`. Brace counting handles nested
// impl blocks correctly.
function findContractImplBlocks(
  code: string,
): Array<{ start: number; end: number }> {
  const blocks: Array<{ start: number; end: number }> = [];
  let i = 0;

  while (i < code.length) {
    const attrMatch = CONTRACT_IMPL_ATTRIBUTE.exec(code.slice(i));
    if (!attrMatch) break;

    const attrIdx = i + attrMatch.index;
    const attrEnd = attrIdx + attrMatch[0].length;

    const implMatch = /\bimpl\b/.exec(code.slice(attrEnd));
    if (!implMatch) {
      i = attrEnd;
      continue;
    }

    const nameStart = attrEnd + implMatch.index;
    const braceStart = code.indexOf('{', nameStart);
    if (braceStart < 0) {
      i = nameStart;
      continue;
    }

    let depth = 0;
    let cursor = braceStart;
    let opened = false;
    while (cursor < code.length) {
      const ch = code[cursor];
      if (ch === '{') {
        depth++;
        opened = true;
      } else if (ch === '}') {
        depth--;
        if (opened && depth === 0) {
          blocks.push({ start: braceStart, end: cursor });
          i = cursor + 1;
          break;
        }
      }
      cursor++;
    }

    if (cursor >= code.length) {
      i = braceStart + 1;
    }
  }

  return blocks;
}

// Walk a single impl block at brace-depth 0 so nested modules, functions,
// and sub-impls are skipped. Only the literal `pub fn` keyword is matched,
// excluding `pub(crate)`, `pub(super)`, and `pub(in path)`. The function
// body (if present) is tracked as +1 brace depth so any nested `pub fn`
// inside it is ignored.
function findTopLevelPubFns(
  code: string,
  blockStart: number,
  blockEnd: number,
): FnInfo[] {
  const fns: FnInfo[] = [];
  // Move past the impl-block opening `{`.
  let i = blockStart + 1;
  let braceDepth = 0;

  while (i < blockEnd) {
    if (braceDepth > 0) {
      const ch = code[i];
      if (ch === '{') braceDepth++;
      else if (ch === '}') braceDepth--;
      i++;
      continue;
    }

    // Top-level of the impl block: only literal `pub fn` matches.
    if (
      code.startsWith('pub fn ', i) ||
      code.startsWith('pub fn\t', i) ||
      code.startsWith('pub fn\n', i)
    ) {
      const fnStartIdx = i;
      const nameStart = i + 'pub fn '.length;
      const nameMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(
        code.slice(nameStart),
      );
      if (!nameMatch) {
        i++;
        continue;
      }
      const fnName = nameMatch[0];
      const afterName = nameStart + fnName.length;

      // Skip whitespace, generics, and `where` clauses until `(` or end.
      let cursor = afterName;
      while (
        cursor < blockEnd &&
        code[cursor] !== '(' &&
        code[cursor] !== '{' &&
        code[cursor] !== ';'
      ) {
        cursor++;
      }
      if (cursor >= blockEnd || code[cursor] !== '(') {
        i = cursor + 1;
        continue;
      }

      // Walk to the matching `)` tracking nested parens (for tuple types).
      let parenDepth = 1;
      cursor++;
      const paramStart = cursor;
      while (cursor < blockEnd && parenDepth > 0) {
        const ch = code[cursor];
        if (ch === '(') parenDepth++;
        else if (ch === ')') {
          parenDepth--;
          if (parenDepth === 0) break;
        }
        cursor++;
      }
      if (cursor >= blockEnd) {
        i = cursor;
        continue;
      }
      // `paramList` is the parameter *contents* only — outer parens are excluded.
      const paramList = code.slice(paramStart, cursor);

      // Skip everything until the body `{` (return type, where, etc.).
      let bodyStart = cursor + 1;
      while (
        bodyStart < blockEnd &&
        code[bodyStart] !== '{' &&
        code[bodyStart] !== ';'
      ) {
        bodyStart++;
      }

      fns.push({
        name: fnName,
        paramList,
        absIdx: fnStartIdx,
      });

      if (bodyStart < blockEnd && code[bodyStart] === '{') {
        // Enter the function body: depth becomes 1 so nested `pub fn`s are
        // skipped and the closing `}` brings us back to the impl top level.
        braceDepth = 1;
        i = bodyStart + 1;
      } else {
        i = bodyStart + 1;
      }
      continue;
    }

    const ch = code[i];
    if (ch === '{') braceDepth++;
    else if (ch === '}') braceDepth--;
    i++;
  }

  return fns;
}

function takesEnvAsFirstArg(paramList: string): boolean {
  const trimmed = paramList.trim();
  if (trimmed.length === 0) return false;
  const firstParam = trimmed.split(/\s*,\s*/)[0].trim();
  // The first parameter of a Soroban entry point has the shape
  // `env: Env` (or `&env`, `&mut env: Env`, `mut env: Env`). The pattern is
  // anchored at the start of the first parameter and requires a `:` after
  // `env`, so identifiers like `env_value: u32` are not misclassified as
  // an environment handle.
  return /^(?:&)?\s*(?:mut\s+)?env\b\s*:/i.test(firstParam);
}

function classify(name: string, paramList: string): VisibilityKind | null {
  if (name.startsWith('_')) {
    return 'underscore-name';
  }
  if (HELPER_TOKEN.test(name)) {
    return takesEnvAsFirstArg(paramList) ? 'helper-name' : 'helper-no-env';
  }
  return null;
}

function lineNumberAt(code: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < code.length; i++) {
    if (code[i] === '\n') line++;
  }
  return line;
}

export function detectInconsistentVisibility(
  code: string,
): InconsistentVisibilityResult {
  const violations: VisibilityViolation[] = [];
  let functionsScanned = 0;
  const implBlocks = findContractImplBlocks(code);

  for (const block of implBlocks) {
    const fns = findTopLevelPubFns(code, block.start, block.end);
    for (const fn of fns) {
      functionsScanned++;
      const kind = classify(fn.name, fn.paramList);
      if (kind === null) continue;

      violations.push({
        functionName: fn.name,
        line: lineNumberAt(code, fn.absIdx),
        visibility: 'pub',
        kind,
        reason: REASON_MAP[kind],
      });
    }
  }

  if (violations.length === 0) {
    return {
      detected: false,
      violations: [],
      functionsScanned,
      implementationsScanned: implBlocks.length,
      message:
        implBlocks.length === 0
          ? 'No `#[contractimpl]` impl blocks found.'
          : 'All `pub fn` declarations inside `#[contractimpl]` impls use consistent visibility.',
      suggestion: '',
    };
  }

  const namesByKind = new Map<VisibilityKind, string[]>();
  for (const v of violations) {
    const list = namesByKind.get(v.kind) ?? [];
    list.push(v.functionName);
    namesByKind.set(v.kind, list);
  }

  const summary = Array.from(namesByKind.entries())
    .map(([kind, names]) => {
      switch (kind) {
        case 'underscore-name':
          return `underscore-prefixed (${names.join(', ')})`;
        case 'helper-name':
          return `helper-style (${names.join(', ')})`;
        case 'helper-no-env':
          return `helper without an \`Env\` parameter (${names.join(', ')})`;
        default:
          return names.join(', ');
      }
    })
    .join('; ');

  return {
    detected: true,
    violations,
    functionsScanned,
    implementationsScanned: implBlocks.length,
    message: `Inconsistent visibility detected on ${violations.length} function(s): ${summary}.`,
    suggestion:
      'Drop the `pub` modifier on internal helpers or switch to `pub(crate)` / `pub(super)` so they are not registered as Soroban contract entry points. Reserve `pub fn` inside `#[contractimpl]` for methods that external transactions are meant to call.',
  };
}
