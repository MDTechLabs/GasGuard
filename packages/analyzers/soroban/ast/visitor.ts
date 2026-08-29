/**
 * Issue #792 — Soroban AST Node Visitor Framework
 *
 * Provides reusable, composable AST visitors for Soroban Rust analysis so that
 * individual rules do not need to implement their own traversal logic. Visitors
 * cover expression, function, and contract-level traversal, and rules can
 * register rule-specific visitors through a simple visitor registry.
 *
 * The framework is built on top of the Rust AST from `packages/parsers/rust`
 * (issue #791) and mirrors the traversal style used by the existing Soroban
 * analyzers in this repo.
 */

import type {
  RustAST,
  RustFunction,
  RustImpl,
  RustParam,
  RustStruct,
  SourceLocation,
} from '../../../parsers/rust/rust-ast-parser';

/** Generic visited-node context passed to every visitor callback. */
export interface VisitContext {
  ast: RustAST;
  /** Parent function when visiting a param/expression; null at contract level. */
  function: RustFunction | null;
  /** Parent impl; null at contract level. */
  impl: RustImpl | null;
  /** Parent struct; null at module level. */
  struct: RustStruct | null;
}

/** Hook interface implemented by rule-specific visitors. */
export interface SorobanAstVisitor {
  /** Unique id of the visitor (usually the rule id). */
  readonly id: string;

  enterContract?(ast: RustAST, context: VisitContext): void;
  exitContract?(ast: RustAST, context: VisitContext): void;

  enterStruct?(node: RustStruct, context: VisitContext): void;
  exitStruct?(node: RustStruct, context: VisitContext): void;

  enterImpl?(node: RustImpl, context: VisitContext): void;
  exitImpl?(node: RustImpl, context: VisitContext): void;

  enterFunction?(node: RustFunction, context: VisitContext): void;
  exitFunction?(node: RustFunction, context: VisitContext): void;

  visitParam?(node: RustParam, context: VisitContext): void;
  visitCall?(call: string, context: VisitContext, location: SourceLocation | null): void;
  visitStorageOp?(op: string, context: VisitContext): void;
}

/** Result collected by a visitor run. */
export interface VisitorRunResult {
  visitedContracts: number;
  visitedStructs: number;
  visitedImpls: number;
  visitedFunctions: number;
  visitedParams: number;
  visitedCalls: number;
  visitedStorageOps: number;
  /** Per-visitor counts keyed by visitor id. */
  visitorActivity: Record<string, number>;
}

/** Traverse an AST, dispatching visitor hooks in document order. */
export function walkAst(
  ast: RustAST,
  visitors: SorobanAstVisitor | SorobanAstVisitor[],
): VisitorRunResult {
  const list = Array.isArray(visitors) ? visitors : [visitors];
  const result: VisitorRunResult = {
    visitedContracts: 0,
    visitedStructs: 0,
    visitedImpls: 0,
    visitedFunctions: 0,
    visitedParams: 0,
    visitedCalls: 0,
    visitedStorageOps: 0,
    visitorActivity: {},
  };

  for (const visitor of list) {
    result.visitorActivity[visitor.id] = 0;
  }

  const context: VisitContext = { ast, function: null, impl: null, struct: null };

  const fire = (fn: ((c: VisitContext) => void) | undefined) => {
    if (fn) fn(context);
  };

  // Contract-level enter
  for (const visitor of list) fire(visitor.enterContract?.bind(visitor, ast));
  result.visitedContracts = list.length;

  for (const struct of ast.structs) {
    const structCtx: VisitContext = { ...context, struct };
    for (const visitor of list) {
      visitor.enterStruct?.(struct, structCtx);
      result.visitorActivity[visitor.id] += 1;
    }
  }

  for (const impl of ast.impls) {
    const implCtx: VisitContext = { ...context, impl };
    for (const visitor of list) {
      visitor.enterImpl?.(impl, implCtx);
      result.visitorActivity[visitor.id] += 1;
    }

    for (const fn of impl.functions) {
      const fnCtx: VisitContext = { ...implCtx, function: fn };
      for (const visitor of list) {
        visitor.enterFunction?.(fn, fnCtx);
        result.visitorActivity[visitor.id] += 1;
      }

      for (const param of fn.params) {
        for (const visitor of list) {
          visitor.visitParam?.(param, fnCtx);
          result.visitorActivity[visitor.id] += 1;
        }
      }

      for (const call of fn.calls) {
        for (const visitor of list) {
          visitor.visitCall?.(call, fnCtx, fn.location);
          result.visitorActivity[visitor.id] += 1;
        }
      }

      for (const op of fn.storageOps) {
        for (const visitor of list) {
          visitor.visitStorageOp?.(op, fnCtx);
          result.visitorActivity[visitor.id] += 1;
        }
      }

      for (const visitor of list) {
        visitor.exitFunction?.(fn, fnCtx);
        result.visitorActivity[visitor.id] += 1;
      }
    }

    for (const visitor of list) {
      visitor.exitImpl?.(impl, implCtx);
      result.visitorActivity[visitor.id] += 1;
    }
  }

  for (const visitor of list) fire(visitor.exitContract?.bind(visitor, ast));
  for (const visitor of list) result.visitorActivity[visitor.id] += 1;

  // Aggregate tallies (approximate; per-visitor activity recorded above).
  result.visitedStructs = ast.structs.length;
  result.visitedImpls = ast.impls.length;
  result.visitedFunctions = ast.impls.reduce((n, i) => n + i.functions.length, 0);
  result.visitedParams = ast.impls.reduce(
    (n, i) => n + i.functions.reduce((m, f) => m + f.params.length, 0),
    0,
  );
  result.visitedCalls = ast.impls.reduce(
    (n, i) => n + i.functions.reduce((m, f) => m + f.calls.length, 0),
    0,
  );
  result.visitedStorageOps = ast.impls.reduce(
    (n, i) => n + i.functions.reduce((m, f) => m + f.storageOps.length, 0),
    0,
  );

  return result;
}

/** Registry that lets rules register their own visitors. */
export class VisitorRegistry {
  private readonly visitors: Map<string, SorobanAstVisitor> = new Map();

  register(visitor: SorobanAstVisitor): void {
    this.visitors.set(visitor.id, visitor);
  }

  unregister(id: string): boolean {
    return this.visitors.delete(id);
  }

  get(id: string): SorobanAstVisitor | undefined {
    return this.visitors.get(id);
  }

  all(): SorobanAstVisitor[] {
    return Array.from(this.visitors.values());
  }

  /** Run all registered visitors over an AST. */
  run(ast: RustAST): VisitorRunResult {
    return walkAst(ast, this.all());
  }
}

/**
 * Base visitor with no-op defaults, so rules implement only the hooks they need.
 * Rule authors subclass/extend this (or implement `SorobanAstVisitor` directly).
 */
export class BaseSorobanVisitor implements SorobanAstVisitor {
  constructor(readonly id: string) {}

  enterContract(_ast: RustAST, _context: VisitContext): void {}
  exitContract(_ast: RustAST, _context: VisitContext): void {}
  enterStruct(_node: RustStruct, _context: VisitContext): void {}
  exitStruct(_node: RustStruct, _context: VisitContext): void {}
  enterImpl(_node: RustImpl, _context: VisitContext): void {}
  exitImpl(_node: RustImpl, _context: VisitContext): void {}
  enterFunction(_node: RustFunction, _context: VisitContext): void {}
  exitFunction(_node: RustFunction, _context: VisitContext): void {}
  visitParam(_node: RustParam, _context: VisitContext): void {}
  visitCall(_call: string, _context: VisitContext, _location: SourceLocation | null): void {}
  visitStorageOp(_op: string, _context: VisitContext): void {}
}