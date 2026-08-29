export interface CachedLengthWarning {
  line: number;
  arrayName: string;
  message: string;
  suggestedRefactor: string;
}

export class SolidityCachedLengthCheckRule {
  public static readonly RULE_ID = 'solidity-cached-length';

  /**
   * Analyzes Solidity contract code for uncached storage array length reads in loops.
   * Re-reading storage array length on every iteration incurs costly SLOAD operations.
   */
  public analyze(sourceCode: string, stateVariables?: string[]): CachedLengthWarning[] {
    const warnings: CachedLengthWarning[] = [];
    const lines = sourceCode.split('\n');

    const detectedStateArrays = new Set<string>(stateVariables || []);

    const stateArrayDeclRegex = /(?:[a-zA-Z0-9_]+(?:\[\])+)\s+(?:public|private|internal)?\s*([a-zA-Z0-9_]+)\s*;/g;
    
    let declMatch;
    while ((declMatch = stateArrayDeclRegex.exec(sourceCode)) !== null) {
      detectedStateArrays.add(declMatch[1]);
    }

    const memoryArrays = new Set<string>();
    const memoryArrayDeclRegex = /(?:[a-zA-Z0-9_]+(?:\[\])+)\s+(?:memory|calldata)\s+([a-zA-Z0-9_]+)/g;
    while ((declMatch = memoryArrayDeclRegex.exec(sourceCode)) !== null) {
      memoryArrays.add(declMatch[1]);
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith('for') || trimmed.startsWith('while') || trimmed.includes('for (') || trimmed.includes('while (')) {
        const lengthMatch = line.match(/([a-zA-Z0-9_]+)\.length/);
        if (lengthMatch) {
          const arrayName = lengthMatch[1];

          if (memoryArrays.has(arrayName)) {
            continue;
          }

          if (detectedStateArrays.size === 0 || detectedStateArrays.has(arrayName) || !memoryArrays.has(arrayName)) {
            const suggestedRefactor = `uint256 len = ${arrayName}.length;\nfor (uint256 i = 0; i < len; i++)`;

            warnings.push({
              line: i + 1,
              arrayName,
              message: `Uncached read of state variable array length '${arrayName}.length' in loop condition incurs SLOAD gas per iteration.`,
              suggestedRefactor,
            });
          }
        }
      }
    }

    return warnings;
  }
}
