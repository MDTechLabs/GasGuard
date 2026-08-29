export interface MutatedVariant {
  id: string;
  mutationType: string;
  originalCode: string;
  mutatedCode: string;
  description: string;
}

export class ASTMutator {
  /**
   * Generates mutated variants of contract source code by injecting gas anti-patterns.
   * @param code Original valid contract source code
   */
  public generateMutations(code: string): MutatedVariant[] {
    const mutations: MutatedVariant[] = [];

    // Mutation 1: Change uint256 to uint8 (un-optimized storage/stack sizing anti-pattern)
    if (code.includes('uint256')) {
      const mutatedCode = code.replace(/\buint256\b/g, 'uint8');
      mutations.push({
        id: `mutant_uint8_${Date.now()}_1`,
        mutationType: 'SUBOPTIMAL_TYPE_SIZING',
        originalCode: code,
        mutatedCode,
        description: 'Replaced uint256 with uint8 (incurs masking overhead)',
      });
    }

    // Mutation 2: Un-cache loop length (uncached array length in loop condition)
    if (/for\s*\([^;]*;\s*[a-zA-Z0-9_]+\s*<\s*len\b/.test(code)) {
      const mutatedCode = code.replace(/<\s*len\b/g, '< arr.length');
      mutations.push({
        id: `mutant_uncached_loop_${Date.now()}_2`,
        mutationType: 'UNCACHED_LOOP_LENGTH',
        originalCode: code,
        mutatedCode,
        description: 'Un-cached loop condition array length evaluation',
      });
    } else if (/for\s*\([^;]+;/.test(code)) {
      // General loop mutation
      const mutatedCode = code.replace(
        /for\s*\(([^;]+);\s*([^;]+);/g,
        'for ($1; $2 && arr.length > 0;'
      );
      mutations.push({
        id: `mutant_loop_condition_${Date.now()}_2`,
        mutationType: 'UNCACHED_LOOP_LENGTH',
        originalCode: code,
        mutatedCode,
        description: 'Injected redundant dynamic array condition check inside loop header',
      });
    }

    // Mutation 3: Change calldata parameter to memory (extra copy overhead)
    if (code.includes('calldata')) {
      const mutatedCode = code.replace(/\bcalldata\b/g, 'memory');
      mutations.push({
        id: `mutant_calldata_to_memory_${Date.now()}_3`,
        mutationType: 'MEMORY_OVER_CALLDATA',
        originalCode: code,
        mutatedCode,
        description: 'Replaced calldata parameter with memory allocation',
      });
    }

    // Mutation 4: Replace ++i with i++ or i = i + 1 (non-prefix increment overhead)
    if (code.includes('++i') || code.includes('++j')) {
      const mutatedCode = code.replace(/\+\+i/g, 'i++').replace(/\+\+j/g, 'j++');
      mutations.push({
        id: `mutant_postfix_inc_${Date.now()}_4`,
        mutationType: 'POSTFIX_INCREMENT',
        originalCode: code,
        mutatedCode,
        description: 'Replaced prefix ++i increment with postfix i++ increment',
      });
    }

    // Mutation 5: Storage re-read anti-pattern
    if (/storage\b/.test(code) || /balances\[/.test(code)) {
      const mutatedCode = code.replace(
        /(balances\[[^\]]+\])/g,
        '$1 + balances[msg.sender]'
      );
      mutations.push({
        id: `mutant_redundant_sload_${Date.now()}_5`,
        mutationType: 'REDUNDANT_STORAGE_READ',
        originalCode: code,
        mutatedCode,
        description: 'Injected redundant storage SLOAD read operations',
      });
    }

    return mutations;
  }
}
