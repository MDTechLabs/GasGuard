/**
 * Token-call helpers shared by the ERC-20 accounting detectors (rebasing assumptions, balance deltas).
 * Lexical only: receivers and arguments are read as text from masked Solidity.
 */
import { findMatching, splitTopLevel } from '../lib/solidity-lite';

export interface TokenCall {
  /** Receiver as written, e.g. `token` or `IERC20(asset)`. */
  receiver: string;
  /** Receiver reduced to the identifier it names: `IERC20(asset)` -> `asset`. */
  token: string;
  method: string;
  args: string[];
  /** Offset of the call inside the scanned text. */
  index: number;
  /** Offset just after the closing parenthesis. */
  end: number;
}

const CALL_RE = /((?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(?:\s*\((?:[^()]|\([^()]*\))*\))?(?:\s*\[[^\]]*\])?)\s*\.\s*(balanceOf|transferFrom|safeTransferFrom|transfer|safeTransfer)\s*\(/g;

/** `IERC20(token)` / `address(token)` / `token` -> `token`; whitespace removed. */
export function normalizeToken(receiver: string): string {
  let r = receiver.replace(/\s+/g, '');
  for (let i = 0; i < 3; i++) {
    const m = /^(?:[A-Z]\w*|address(?:payable)?)\((.*)\)$/.exec(r);
    if (!m) break;
    r = m[1];
  }
  return r;
}

/** Token calls (`balanceOf`, `transfer`, `transferFrom` and the safe variants) in a piece of text. */
export function findTokenCalls(text: string): TokenCall[] {
  const out: TokenCall[] = [];
  CALL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CALL_RE.exec(text)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = findMatching(text, open, '(', ')');
    if (close === -1) continue;
    out.push({
      receiver: m[1].replace(/\s+/g, ''),
      token: normalizeToken(m[1]),
      method: m[2],
      args: splitTopLevel(text.slice(open + 1, close)).map((a) => a.trim()),
      index: m.index,
      end: close + 1,
    });
  }
  return out;
}

export function isSelf(expr: string): boolean {
  return /^address\s*\(\s*this\s*\)$/.test(expr.trim()) || expr.trim() === 'this';
}

export function words(text: string): string[] {
  return text.match(/[A-Za-z_$][\w$]*/g) ?? [];
}

/** Local variable definitions (`uint256 x = ...;` or `x = ...;`) of a statement list: name -> right-hand side. */
export function localDefs(statements: string[], isState: (name: string) => boolean): Map<string, string> {
  const defs = new Map<string, string>();
  const re = /^(?:[A-Za-z_$][\w$]*(?:\[\d*\])?\s+(?:(?:memory|calldata|storage)\s+)?)?([A-Za-z_$][\w$]*)\s*=(?!=)\s*([\s\S]+)$/;
  for (const s of statements) {
    const m = re.exec(s);
    if (m && !isState(m[1]) && !/^(return|emit|revert|delete|require|assert)$/.test(m[1])) defs.set(m[1], (defs.get(m[1]) ?? '') + ' ' + m[2]);
  }
  return defs;
}

/** Identifiers of `text` plus those of the local definitions they depend on (up to `depth` steps). */
export function expandWords(text: string, defs: Map<string, string>, depth = 3): Set<string> {
  const seen = new Set<string>(words(text));
  let frontier = [...seen];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const w of frontier) {
      const rhs = defs.get(w);
      if (!rhs) continue;
      for (const x of words(rhs)) if (!seen.has(x)) { seen.add(x); next.push(x); }
    }
    frontier = next;
  }
  return seen;
}
