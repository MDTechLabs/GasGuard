/**
 * LSP (Language Server Protocol) Integration (#247)
 *
 * Provides real-time IDE diagnostics via a minimal LSP server implementation.
 */

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export type DiagnosticSeverity = 1 | 2 | 3 | 4; // Error | Warning | Information | Hint

export interface LspDiagnostic {
  range: LspRange;
  severity: DiagnosticSeverity;
  code?: string;
  source: string;
  message: string;
}

export interface TextDocument {
  uri: string;
  languageId: string;
  content: string;
}

export type AnalyzeFn = (doc: TextDocument) => Promise<LspDiagnostic[]>;

export class GasGuardLspServer {
  private analyzeFn: AnalyzeFn;
  private diagnosticsCache = new Map<string, LspDiagnostic[]>();

  constructor(analyzeFn: AnalyzeFn) {
    this.analyzeFn = analyzeFn;
  }

  /**
   * Handle textDocument/didOpen and textDocument/didChange notifications.
   * Returns diagnostics to publish to the client.
   */
  async onDocumentChange(doc: TextDocument): Promise<LspDiagnostic[]> {
    const diagnostics = await this.analyzeFn(doc);
    this.diagnosticsCache.set(doc.uri, diagnostics);
    return diagnostics;
  }

  /**
   * Handle textDocument/didClose — clear cached diagnostics.
   */
  onDocumentClose(uri: string): void {
    this.diagnosticsCache.delete(uri);
  }

  /**
   * Get cached diagnostics for a document URI.
   */
  getDiagnostics(uri: string): LspDiagnostic[] {
    return this.diagnosticsCache.get(uri) ?? [];
  }

  /**
   * Convert an AnalysisResult-style finding to an LspDiagnostic.
   */
  static toDiagnostic(
    line: number,
    message: string,
    code: string,
    severity: DiagnosticSeverity = 2
  ): LspDiagnostic {
    return {
      range: {
        start: { line: line - 1, character: 0 },
        end: { line: line - 1, character: Number.MAX_SAFE_INTEGER },
      },
      severity,
      code,
      source: 'gasguard',
      message,
    };
  }
}
