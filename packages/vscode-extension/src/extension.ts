/**
 * GasGuard VS Code extension entry point. Registers a diagnostic collection and
 * refreshes inline warnings as supported files are opened, edited, and saved.
 */

import * as vscode from "vscode";

import { GasRuleMatch, refreshDiagnostics } from "./diagnostics";

const SUPPORTED_EXTENSIONS = [".sol", ".rs"];

export function activate(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection("gasguard");
  context.subscriptions.push(collection);

  const scan = (document: vscode.TextDocument): void => {
    if (!isSupported(document)) {
      return;
    }
    refreshDiagnostics(document, collection, analyze(document));
  };

  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    scan(activeEditor.document);
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(scan),
    vscode.workspace.onDidSaveTextDocument(scan),
    vscode.workspace.onDidChangeTextDocument((event) => scan(event.document)),
  );
}

function isSupported(document: vscode.TextDocument): boolean {
  return SUPPORTED_EXTENSIONS.some((extension) =>
    document.fileName.endsWith(extension),
  );
}

/**
 * Placeholder analysis hook. Wire this to the GasGuard engine to surface real
 * matches; until then it reports nothing rather than fabricating diagnostics.
 */
function analyze(_document: vscode.TextDocument): GasRuleMatch[] {
  return [];
}

export function deactivate(): void {
  // Diagnostic collection is disposed via context.subscriptions.
}
