/**
 * Symbol-aware finding context (#1164).
 *
 * A finding that only carries a line number is hard to triage: the line may
 * have moved, and reviewers need to know which symbol it landed in. This module
 * attaches the innermost enclosing symbol to each finding, using the symbol
 * spans the parser already produced, so a finding can be reported as
 * `Token.transfer` rather than `line 118`.
 *
 * Spans are validated once and sorted by span size, which makes "innermost"
 * well defined: the smallest span that contains the finding's line wins.
 */

export type SymbolKind =
  | "function"
  | "method"
  | "class"
  | "interface"
  | "struct"
  | "const"
  | "unknown";

export interface SymbolSpan {
  name: string;
  kind: SymbolKind;
  /** 1-based inclusive start line. */
  startLine: number;
  /** 1-based inclusive end line. */
  endLine: number;
  /** Enclosing symbol name, when the parser reported one. */
  container?: string;
}

export interface SymbolContext {
  name: string;
  kind: SymbolKind;
  qualifiedName: string;
  startLine: number;
  endLine: number;
}

export interface ContextualFinding<T> {
  finding: T;
  /** Undefined when the finding is outside every reported symbol. */
  symbol?: SymbolContext;
}

export class SymbolSpanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SymbolSpanError";
  }
}

export function validateSymbolSpan(span: SymbolSpan): void {
  if (!span || typeof span.name !== "string" || span.name.trim() === "") {
    throw new SymbolSpanError("symbol name must be a non-empty string");
  }
  if (!Number.isInteger(span.startLine) || span.startLine < 1) {
    throw new SymbolSpanError(`symbol ${span.name} has an invalid startLine`);
  }
  if (!Number.isInteger(span.endLine) || span.endLine < span.startLine) {
    throw new SymbolSpanError(`symbol ${span.name} ends before it starts`);
  }
}

/** `Container.name` when a container is known, otherwise the bare name. */
export function qualifiedSymbolName(span: SymbolSpan): string {
  const container = span.container?.trim();
  return container ? `${container}.${span.name}` : span.name;
}

/**
 * The innermost symbol containing `line`.
 *
 * On identical spans the later-declared symbol wins, which matches the common
 * case of a nested re-declaration shadowing its parent.
 */
export function findEnclosingSymbol(
  symbols: readonly SymbolSpan[],
  line: number,
): SymbolSpan | undefined {
  if (!Number.isInteger(line) || line < 1) {
    throw new RangeError("line must be a positive integer");
  }

  const enclosing = symbols.filter((span) => {
    validateSymbolSpan(span);
    return span.startLine <= line && line <= span.endLine;
  });

  if (enclosing.length === 0) {
    return undefined;
  }

  return enclosing.sort(
    (left, right) =>
      left.endLine - left.startLine - (right.endLine - right.startLine) ||
      right.startLine - left.startLine,
  )[0];
}

/** Attach symbol context to findings, preserving input order. */
export function attachSymbolContext<T extends { line: number }>(
  findings: readonly T[],
  symbols: readonly SymbolSpan[],
): Array<ContextualFinding<T>> {
  return findings.map((finding) => {
    const span = findEnclosingSymbol(symbols, finding.line);
    if (!span) {
      return { finding };
    }

    return {
      finding,
      symbol: {
        name: span.name,
        kind: span.kind,
        qualifiedName: qualifiedSymbolName(span),
        startLine: span.startLine,
        endLine: span.endLine,
      },
    };
  });
}

/** Group findings by their enclosing symbol, stable by qualified name. */
export function groupFindingsBySymbol<T extends { line: number }>(
  findings: readonly T[],
  symbols: readonly SymbolSpan[],
): Array<{ symbol?: string; findings: T[] }> {
  const groups = new Map<string, T[]>();

  for (const { finding, symbol } of attachSymbolContext(findings, symbols)) {
    const key = symbol?.qualifiedName ?? "";
    groups.set(key, [...(groups.get(key) ?? []), finding]);
  }

  return [...groups.entries()]
    .map(([symbol, grouped]) => ({
      ...(symbol === "" ? {} : { symbol }),
      findings: grouped,
    }))
    .sort((left, right) => {
      if (left.symbol === right.symbol) {
        return 0;
      }
      if (left.symbol === undefined) {
        return 1;
      }
      if (right.symbol === undefined) {
        return -1;
      }
      return left.symbol < right.symbol ? -1 : 1;
    });
}
