import {
  LedgerWriteOperation,
  WriteAnalysisResult,
  WriteCostMetrics,
  OptimizationSuggestion,
  StorageTier,
  WriteOperationType,
} from './types';

// Constants for Soroban fee estimations
const BASE_LEDGER_WRITE_FEE_STROOPS = 10000; // Base stroops per ledger entry mutation/write
const BASE_WRITE_CPU_INSTRUCTIONS = 2500;   // Estimated host CPU instructions per write

export class SorobanLedgerWriteCostAnalyzer {
  /**
   * Analyze Soroban smart contract source code for ledger write costs and state mutations.
   */
  public analyze(sourceCode: string, fileName: string = 'contract.rs'): WriteAnalysisResult {
    const writes = this.extractWrites(sourceCode);
    const repeatedWrites = this.groupRepeatedWrites(writes);
    const unnecessaryMutations = this.identifyUnnecessaryMutations(writes, sourceCode);
    const highImpactPatterns = this.identifyHighImpactPatterns(writes);
    const metrics = this.calculateMetrics(writes, repeatedWrites, unnecessaryMutations);
    const suggestions = this.generateSuggestions(writes, repeatedWrites, unnecessaryMutations, highImpactPatterns);

    return {
      writes,
      repeatedWrites,
      unnecessaryMutations,
      highImpactPatterns,
      metrics,
      suggestions,
    };
  }

  /**
   * Detects all ledger write operations from source code.
   */
  private extractWrites(sourceCode: string): LedgerWriteOperation[] {
    const writes: LedgerWriteOperation[] = [];
    const lines = sourceCode.split(/\r?\n/);

    let currentFunction = 'global';
    let inLoop = false;
    let loopDepth = 0;
    let braceBalance = 0;
    const loopBraceLevels: number[] = [];

    const fnRegex = /(?:pub\s+)?fn\s+([a-zA-Z0-9_]+)\s*\(/;
    const loopRegex = /\b(for\s+.*?\s+in\s+.*|while\s+.*|loop)\s*\{/;

    // Storage write matching regex: storage().instance().set(&key, &val) or storage().persistent().remove(&key)
    const writeRegex = /(?:env\.)?storage\(\)\.(instance|persistent|temporary)\(\)\.(set|remove|store|update)\s*\(([^)]*)\)/g;
    const directWriteRegex = /(?:env\.)?storage\(\)\.(set|remove)\s*\(([^)]*)\)/g;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      const lineNum = i + 1;

      const fnMatch = trimmed.match(fnRegex);
      if (fnMatch) {
        currentFunction = fnMatch[1];
      }

      if (loopRegex.test(trimmed)) {
        loopDepth++;
        inLoop = true;
        loopBraceLevels.push(braceBalance);
      }

      for (const char of line) {
        if (char === '{') braceBalance++;
        if (char === '}') {
          braceBalance--;
          if (loopBraceLevels.length > 0 && braceBalance <= loopBraceLevels[loopBraceLevels.length - 1]) {
            loopBraceLevels.pop();
            loopDepth = loopBraceLevels.length;
            inLoop = loopDepth > 0;
          }
        }
      }

      // 1. Tiered storage writes
      let match: RegExpExecArray | null;
      writeRegex.lastIndex = 0;
      while ((match = writeRegex.exec(line)) !== null) {
        const tier = match[1] as StorageTier;
        const opType = match[2] as WriteOperationType;
        const rawArgs = match[3]?.trim() || '';
        const { key, value } = this.parseWriteArguments(rawArgs);

        writes.push({
          id: `write_${lineNum}_${writes.length + 1}`,
          storageTier: tier,
          opType,
          key: key || `unknown_key_L${lineNum}`,
          valueExpression: value,
          line: lineNum,
          column: match.index + 1,
          enclosingFunction: currentFunction,
          isInLoop,
          loopDepth,
          rawExpression: match[0],
        });
      }

      // 2. Direct storage writes
      directWriteRegex.lastIndex = 0;
      while ((match = directWriteRegex.exec(line)) !== null) {
        const opType = match[1] as WriteOperationType;
        const rawArgs = match[2]?.trim() || '';
        const { key, value } = this.parseWriteArguments(rawArgs);

        writes.push({
          id: `write_${lineNum}_${writes.length + 1}`,
          storageTier: 'unknown',
          opType,
          key: key || `unknown_key_L${lineNum}`,
          valueExpression: value,
          line: lineNum,
          column: match.index + 1,
          enclosingFunction: currentFunction,
          isInLoop,
          loopDepth,
          rawExpression: match[0],
        });
      }
    }

    return writes;
  }

  /**
   * Parse comma-separated arguments in `.set(&key, &value)`.
   */
  private parseWriteArguments(rawArgs: string): { key: string; value?: string } {
    const parts = rawArgs.split(',').map((p) => p.replace(/^&/, '').trim());
    return {
      key: parts[0] || '',
      value: parts.length > 1 ? parts[1] : undefined,
    };
  }

  /**
   * Group repeated writes to the same storage key within the same function.
   */
  private groupRepeatedWrites(writes: LedgerWriteOperation[]): Map<string, LedgerWriteOperation[]> {
    const grouped = new Map<string, LedgerWriteOperation[]>();

    for (const write of writes) {
      const groupKey = `${write.enclosingFunction}::${write.key}`;
      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, []);
      }
      grouped.get(groupKey)!.push(write);
    }

    const repeated = new Map<string, LedgerWriteOperation[]>();
    for (const [key, ops] of grouped.entries()) {
      if (ops.length > 1) {
        repeated.set(key, ops);
      }
    }

    return repeated;
  }

  /**
   * Identifies unnecessary mutations such as repeated writes, unconditional re-writes, or writes in getters.
   */
  private identifyUnnecessaryMutations(
    writes: LedgerWriteOperation[],
    sourceCode: string
  ): WriteAnalysisResult['unnecessaryMutations'] {
    const mutations: WriteAnalysisResult['unnecessaryMutations'] = [];

    // Check for writes in read-only / getter named functions
    const getterPrefixes = ['get_', 'is_', 'has_', 'read_', 'check_', 'query_'];
    const writesInGetters = writes.filter((w) =>
      getterPrefixes.some((prefix) => w.enclosingFunction.startsWith(prefix))
    );

    if (writesInGetters.length > 0) {
      const groupedByFn = new Map<string, LedgerWriteOperation[]>();
      for (const w of writesInGetters) {
        if (!groupedByFn.has(w.enclosingFunction)) groupedByFn.set(w.enclosingFunction, []);
        groupedByFn.get(w.enclosingFunction)!.push(w);
      }

      for (const [fn, ops] of groupedByFn.entries()) {
        mutations.push({
          key: ops[0].key,
          reason: `Storage mutation occurring within view/query function '${fn}'. Queries should generally be side-effect free.`,
          occurrences: ops,
        });
      }
    }

    // Check for multiple writes to the same key without intervening reads
    const groupedByFnAndKey = new Map<string, LedgerWriteOperation[]>();
    for (const write of writes) {
      const key = `${write.enclosingFunction}::${write.key}`;
      if (!groupedByFnAndKey.has(key)) groupedByFnAndKey.set(key, []);
      groupedByFnAndKey.get(key)!.push(write);
    }

    for (const [groupKey, ops] of groupedByFnAndKey.entries()) {
      if (ops.length > 1) {
        const [fn, keyName] = groupKey.split('::');
        mutations.push({
          key: keyName,
          reason: `Multiple writes to key '${keyName}' in function '${fn}'. Redundant intermediate state writes inflate ledger entry mutation costs.`,
          occurrences: ops,
        });
      }
    }

    return mutations;
  }

  /**
   * Identifies high-impact write patterns.
   */
  private identifyHighImpactPatterns(writes: LedgerWriteOperation[]): WriteAnalysisResult['highImpactPatterns'] {
    const patterns: WriteAnalysisResult['highImpactPatterns'] = [];
    const fnCounts = new Map<string, { count: number; loopWrites: LedgerWriteOperation[] }>();

    for (const write of writes) {
      const entry = fnCounts.get(write.enclosingFunction) || { count: 0, loopWrites: [] };
      entry.count++;
      if (write.isInLoop) {
        entry.loopWrites.push(write);
      }
      fnCounts.set(write.enclosingFunction, entry);
    }

    for (const [fnName, data] of fnCounts.entries()) {
      if (data.loopWrites.length > 0) {
        patterns.push({
          functionName: fnName,
          writeCount: data.count,
          hasLoopWrites: true,
          riskLevel: 'high',
          description: `Function '${fnName}' contains ${data.loopWrites.length} ledger write(s) inside loop constructs. Each iteration creates an expensive ledger mutation.`,
        });
      } else if (data.count >= 4) {
        patterns.push({
          functionName: fnName,
          writeCount: data.count,
          hasLoopWrites: false,
          riskLevel: 'medium',
          description: `Function '${fnName}' executes ${data.count} state writes across individual storage keys. High mutation volume increases base transaction fee and ledger rent footprint.`,
        });
      }
    }

    return patterns;
  }

  /**
   * Calculate metrics for writes.
   */
  private calculateMetrics(
    writes: LedgerWriteOperation[],
    repeatedWrites: Map<string, LedgerWriteOperation[]>,
    unnecessaryMutations: WriteAnalysisResult['unnecessaryMutations']
  ): WriteCostMetrics {
    const uniqueKeys = new Set(writes.map((w) => w.key)).size;
    const loopWrites = writes.filter((w) => w.isInLoop).length;
    let repeatedWriteCount = 0;

    for (const ops of repeatedWrites.values()) {
      repeatedWriteCount += ops.length - 1;
    }

    return {
      totalWrites: writes.length,
      uniqueKeysWritten: uniqueKeys,
      repeatedWriteCount,
      loopWriteCount: loopWrites,
      unnecessaryMutationCount: unnecessaryMutations.length,
      estimatedCpuInstructions: writes.length * BASE_WRITE_CPU_INSTRUCTIONS,
      estimatedWriteEntryFeeStroops: writes.length * BASE_LEDGER_WRITE_FEE_STROOPS,
    };
  }

  /**
   * Generate actionable optimization suggestions for writes.
   */
  private generateSuggestions(
    writes: LedgerWriteOperation[],
    repeatedWrites: Map<string, LedgerWriteOperation[]>,
    unnecessaryMutations: WriteAnalysisResult['unnecessaryMutations'],
    highImpactPatterns: WriteAnalysisResult['highImpactPatterns']
  ): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];

    // 1. Suggestions for Loop Writes (Critical / High Severity)
    const loopWrites = writes.filter((w) => w.isInLoop);
    for (const loopWrite of loopWrites) {
      suggestions.push({
        id: `OPT_WRITE_LOOP_${loopWrite.id}`,
        title: `Ledger Write in Loop: '${loopWrite.key}'`,
        description: `Ledger mutation '${loopWrite.rawExpression}' is performed inside a loop in function '${loopWrite.enclosingFunction}'. In Soroban, writing state per loop iteration incurs massive rent and write entry fees.`,
        severity: 'high',
        category: 'loop_hoisting',
        affectedKey: loopWrite.key,
        line: loopWrite.line,
        functionName: loopWrite.enclosingFunction,
        suggestedFix: `Accumulate mutations in a local collection (e.g. Map/Vec) and perform batched or final ledger write outside the loop.`,
        estimatedResourceSavings: `Saves up to ${BASE_LEDGER_WRITE_FEE_STROOPS * 10} stroops per call depending on iteration count.`,
      });
    }

    // 2. Suggestions for Repeated Writes to the Same Key
    for (const [groupKey, ops] of repeatedWrites.entries()) {
      const [fnName, key] = groupKey.split('::');
      const lines = ops.map((o) => o.line).join(', ');
      suggestions.push({
        id: `OPT_REPEATED_WRITE_${fnName}_${key}`,
        title: `Redundant State Write: '${key}'`,
        description: `Storage key '${key}' is written to ${ops.length} times in function '${fnName}' (lines: ${lines}).`,
        severity: 'medium',
        category: 'redundant_mutation',
        affectedKey: key,
        line: ops[0].line,
        functionName: fnName,
        suggestedFix: `Coalesce intermediate state mutations into a local variable and execute a single ledger write: 'env.storage().${ops[0].storageTier}().set(&${key}, &final_val);'`,
        estimatedResourceSavings: `Eliminates ${ops.length - 1} redundant ledger writes (~${(ops.length - 1) * BASE_LEDGER_WRITE_FEE_STROOPS} stroops).`,
      });
    }

    // 3. High Impact Pattern Suggestions
    for (const pattern of highImpactPatterns) {
      if (!pattern.hasLoopWrites && pattern.writeCount >= 4) {
        suggestions.push({
          id: `OPT_WRITE_VOLUME_${pattern.functionName}`,
          title: `High Write Volume in '${pattern.functionName}'`,
          description: pattern.description,
          severity: 'medium',
          category: 'batching',
          functionName: pattern.functionName,
          suggestedFix: `Bundle discrete storage keys into a composite contract struct type with '#[contracttype]' to reduce the number of separate ledger keys written.`,
          estimatedResourceSavings: `Reduces ledger entry write count from ${pattern.writeCount} to 1.`,
        });
      }
    }

    return suggestions;
  }
}
