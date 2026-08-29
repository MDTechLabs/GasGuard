export interface CodeFeatures {
  cyclomaticComplexity: number;
  maxLoopDepth: number;
  variableCount: number;
  storageAccesses: number;
  memoryAllocations: number;
}

export class FeatureExtractor {
  /**
   * Extracts structural AST and code complexity features from source code.
   * @param code Smart contract or function source code
   */
  public extractFeatures(code: string): CodeFeatures {
    if (!code || code.trim().length === 0) {
      return {
        cyclomaticComplexity: 1,
        maxLoopDepth: 0,
        variableCount: 0,
        storageAccesses: 0,
        memoryAllocations: 0,
      };
    }

    const cyclomaticComplexity = this.calculateCyclomaticComplexity(code);
    const maxLoopDepth = this.calculateMaxLoopDepth(code);
    const variableCount = this.calculateVariableCount(code);
    const storageAccesses = this.calculateStorageAccesses(code);
    const memoryAllocations = this.calculateMemoryAllocations(code);

    return {
      cyclomaticComplexity,
      maxLoopDepth,
      variableCount,
      storageAccesses,
      memoryAllocations,
    };
  }

  private calculateCyclomaticComplexity(code: string): number {
    let complexity = 1;
    const decisionPatterns = [
      /\bif\s*\(/g,
      /\belse\s+if\s*\(/g,
      /\bfor\s*\(/g,
      /\bwhile\s*\(/g,
      /\bcase\s+/g,
      /\bcatch\s*/g,
      /\brequire\s*\(/g,
      /\bassert\s*\(/g,
      /&&/g,
      /\|\|/g,
      /\?/g,
    ];

    for (const pattern of decisionPatterns) {
      const matches = code.match(pattern);
      if (matches) {
        complexity += matches.length;
      }
    }

    return complexity;
  }

  private calculateMaxLoopDepth(code: string): number {
    const lines = code.split('\n');
    let currentDepth = 0;
    let maxDepth = 0;
    const loopStack: number[] = [];

    for (const line of lines) {
      const isLoopStart = /\b(for|while|do)\b/.test(line);
      const openBraces = (line.match(/\{/g) || []).length;
      const closeBraces = (line.match(/\}/g) || []).length;

      if (isLoopStart) {
        currentDepth += 1;
        if (currentDepth > maxDepth) {
          maxDepth = currentDepth;
        }
        loopStack.push(openBraces);
      } else if (loopStack.length > 0) {
        if (closeBraces > 0) {
          currentDepth = Math.max(0, currentDepth - closeBraces);
          if (currentDepth === 0) {
            loopStack.pop();
          }
        }
      }
    }

    if (maxDepth === 0 && /\b(for|while)\b/.test(code)) {
      maxDepth = 1;
      if (/(for|while)[^{}]*(for|while)/.test(code.replace(/\s+/g, ' '))) {
        maxDepth = 2;
      }
    }

    return maxDepth;
  }

  private calculateVariableCount(code: string): number {
    const declPattern = /\b(uint\d*|int\d*|address|bytes\d*|string|bool|mapping|struct|let|const|var)\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
    const matches = code.match(declPattern);
    return matches ? matches.length : 0;
  }

  private calculateStorageAccesses(code: string): number {
    let count = 0;
    const storageKeywords = [
      /\bstorage\b/g,
      /\bSLOAD\b/g,
      /\bSSTORE\b/g,
      /\.sload\b/g,
      /\.sstore\b/g,
      /self\.[a-zA-Z0-9_]+/g,
    ];

    for (const pattern of storageKeywords) {
      const matches = code.match(pattern);
      if (matches) {
        count += matches.length;
      }
    }

    const mappingAccess = /[a-zA-Z0-9_]+\s*\[[^\]]+\]/g;
    const mapMatches = code.match(mappingAccess);
    if (mapMatches) {
      count += mapMatches.length;
    }

    return count;
  }

  private calculateMemoryAllocations(code: string): number {
    let count = 0;
    const memoryPatterns = [
      /\bmemory\b/g,
      /\bnew\s+[a-zA-Z0-9_]+(\[\s*\]|\([^\)]*\))/g,
      /\bmstore\b/g,
      /\babi\.encode\b/g,
      /\babi\.encodePacked\b/g,
    ];

    for (const pattern of memoryPatterns) {
      const matches = code.match(pattern);
      if (matches) {
        count += matches.length;
      }
    }

    return count;
  }
}
