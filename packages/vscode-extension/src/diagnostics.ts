/**
 * Maps GasGuard rule matches to VS Code diagnostics so gas anti-patterns show
 * as inline squiggly underlines while editing, with the estimated gas saving
 * surfaced in the hover message.
 */

import * as vscode from "vscode";

export const DIAGNOSTIC_SOURCE = "gasguard";

export interface GasRuleMatch {
  ruleId: string;
  /** Human-readable rule description shown on hover. */
  message: string;
  /** 1-based line number. */
  line: number;
  /** 1-based start column. Defaults to the start of the line. */
  column?: number;
  /** 1-based end column. Defaults to one character past the start column. */
  endColumn?: number;
  /** Estimated gas saved if the suggested fix is applied. */
  gasSavings?: number;
}

/** Convert a single rule match into a `vscode.Diagnostic` (Warning severity). */
export function buildDiagnostic(match: GasRuleMatch): vscode.Diagnostic {
  const line = Math.max(0, match.line - 1);
  const startColumn = Math.max(0, (match.column ?? 1) - 1);
  const endColumn =
    match.endColumn !== undefined
      ? Math.max(startColumn, match.endColumn - 1)
      : startColumn + 1;

  const range = new vscode.Range(line, startColumn, line, endColumn);
  const savings =
    match.gasSavings !== undefined
      ? ` (est. ${match.gasSavings} gas saved)`
      : "";

  const diagnostic = new vscode.Diagnostic(
    range,
    `${match.message}${savings}`,
    vscode.DiagnosticSeverity.Warning,
  );
  diagnostic.source = DIAGNOSTIC_SOURCE;
  diagnostic.code = match.ruleId;
  return diagnostic;
}

/** Replace the diagnostics for `document` with the given matches. */
export function refreshDiagnostics(
  document: vscode.TextDocument,
  collection: vscode.DiagnosticCollection,
  matches: GasRuleMatch[],
): void {
  collection.set(document.uri, matches.map(buildDiagnostic));
}
