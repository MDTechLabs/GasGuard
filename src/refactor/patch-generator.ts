import { ASTRewriter, TextReplacement } from './ast-rewriter';

export interface DiagnosticRuleWarning {
  line: number;
  message: string;
  originalCodeSnippet?: string;
  suggestedRefactor?: string;
}

export class PatchGenerator {
  /**
   * Generates a valid unified Git diff patch string (.patch) for code optimization warnings.
   */
  public generatePatch(
    filePath: string,
    originalContent: string,
    modifiedContent: string
  ): string {
    const origLines = originalContent.split('\n');
    const modLines = modifiedContent.split('\n');

    const header = `--- a/${filePath}\n+++ b/${filePath}\n`;

    let diffBody = '';
    const origCount = origLines.length;
    const modCount = modLines.length;

    diffBody += `@@ -1,${origCount} +1,${modCount} @@\n`;

    let i = 0, j = 0;
    while (i < origLines.length || j < modLines.length) {
      if (i < origLines.length && j < modLines.length && origLines[i] === modLines[j]) {
        diffBody += ` ${origLines[i]}\n`;
        i++;
        j++;
      } else if (j < modLines.length && (i >= origLines.length || origLines[i] !== modLines[j])) {
        if (i < origLines.length && !modLines.slice(j).includes(origLines[i])) {
          diffBody += `-${origLines[i]}\n`;
          i++;
        } else {
          diffBody += `+${modLines[j]}\n`;
          j++;
        }
      } else if (i < origLines.length) {
        diffBody += `-${origLines[i]}\n`;
        i++;
      }
    }

    return header + diffBody;
  }

  /**
   * Generates patch directly from diagnostic rule warnings and replacements.
   */
  public generatePatchFromReplacements(
    filePath: string,
    originalContent: string,
    replacements: TextReplacement[]
  ): string {
    const startTime = Date.now();
    const modifiedContent = ASTRewriter.applyReplacements(originalContent, replacements);
    const patch = this.generatePatch(filePath, originalContent, modifiedContent);
    const duration = Date.now() - startTime;

    if (duration > 50) {
      console.warn(`Patch generation exceeded performance target: ${duration}ms`);
    }

    return patch;
  }
}
