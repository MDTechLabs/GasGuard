export interface TextReplacement {
  startLine: number; // 1-indexed
  endLine: number; // 1-indexed
  originalText: string;
  replacementText: string;
}

export class ASTRewriter {
  /**
   * Applies line-range string replacements non-destructively to source file content.
   */
  public static applyReplacements(originalContent: string, replacements: TextReplacement[]): string {
    const lines = originalContent.split('\n');

    // Sort replacements descending by startLine to avoid invalidating line numbers
    const sorted = [...replacements].sort((a, b) => b.startLine - a.startLine);

    for (const r of sorted) {
      const startIdx = r.startLine - 1;
      const deleteCount = r.endLine - r.startLine + 1;
      const newLines = r.replacementText.split('\n');
      lines.splice(startIdx, deleteCount, ...newLines);
    }

    return lines.join('\n');
  }
}
