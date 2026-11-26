/**
 * Contract-level helpers for detectors that need inheritance or modifier information.
 * Text based, single file, never throws. Works on sanitized source from `validateSource`.
 */
import { findMatching, splitTopLevel } from "./solidity-source";

export interface ContractRange {
  name: string;
  kind: "contract" | "library" | "interface";
  abstract: boolean;
  bases: string[];
  /** Index of the opening brace in the sanitized source. */
  open: number;
  /** Index of the closing brace in the sanitized source. */
  close: number;
}

export function extractContractRanges(clean: string): ContractRange[] {
  const out: ContractRange[] = [];
  const re = /\b(abstract\s+)?(contract|library|interface)\s+([A-Za-z_$][\w$]*)([^{;]*)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = findMatching(clean, open);
    if (close < 0) continue;
    const isClause = /^\s*is\b([\s\S]*)$/.exec(m[4]);
    const bases = isClause
      ? splitTopLevel(isClause[1])
          .map((b) => b.trim().replace(/\([\s\S]*$/, "").trim())
          .filter(Boolean)
      : [];
    out.push({ name: m[3], kind: m[2] as ContractRange["kind"], abstract: !!m[1], bases, open, close });
    re.lastIndex = open + 1;
  }
  return out;
}

/** Innermost contract that contains the index. */
export function contractAtIndex(ranges: ContractRange[], index: number): ContractRange | undefined {
  let best: ContractRange | undefined;
  for (const r of ranges) {
    if (index > r.open && index < r.close && (!best || r.close - r.open < best.close - best.open)) best = r;
  }
  return best;
}

/** The contract itself followed by every ancestor defined in the same file. */
export function linearize(ranges: ContractRange[], name: string): ContractRange[] {
  const byName = new Map(ranges.map((r) => [r.name, r]));
  const seen = new Set<string>();
  const order: ContractRange[] = [];
  const visit = (n: string) => {
    const r = byName.get(n);
    if (!r || seen.has(n)) return;
    seen.add(n);
    order.push(r);
    for (const b of r.bases) visit(b);
  };
  visit(name);
  return order;
}

const HEADER_KEYWORDS = new Set([
  "public", "external", "internal", "private", "view", "pure", "payable", "nonpayable",
  "virtual", "override", "returns", "constant",
]);

/** Names of modifier invocations in a function header. */
export function modifierNames(header: string): string[] {
  const stripped = header
    .replace(/\breturns\s*\([^)]*\)/g, " ")
    .replace(/\boverride\s*\([^)]*\)/g, " ");
  const names: string[] = [];
  const re = /\b([A-Za-z_$][\w$]*)\s*(?:\([^)]*\))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    if (!HEADER_KEYWORDS.has(m[1])) names.push(m[1]);
  }
  return names;
}

/** Nesting depth of `index` relative to the contract body (1 means directly inside the contract). */
export function depthInContract(clean: string, contract: ContractRange, index: number): number {
  let depth = 0;
  for (let i = contract.open; i < index && i < clean.length; i++) {
    if (clean[i] === "{") depth++;
    else if (clean[i] === "}") depth--;
  }
  return depth;
}
