import {
  LedgerReadOperation,
  ReadAnalysisResult,
  ReadCostMetrics,
  OptimizationSuggestion,
  StorageTier,
  ReadOperationType,
} from './types';

// Constants for Soroban fee estimations
const BASE_LEDGER_READ_FEE_STROOPS = 5000; // Base stroops per ledger entry read
const BASE_READ_CPU_INSTRUCTIONS = 1200;   // Estimated host CPU instructions per read

export class SorobanLedgerReadCostAnalyzer {
  /**
   * Analyze Soroban smart contract source code for ledger read costs.
   */
  public analyze(sourceCode: string, fileName: string = 'contract.rs'): ReadAnalysisResult {
    const reads = this.extractReads(sourceCode);
    const repeatedReads = this.groupRepeatedReads(reads);
    const readHeavyPaths = this.identifyReadHeavyPaths(reads);
    const metrics = this.calculateMetrics(reads, repeatedReads);
    const suggestions = this.generateSuggestions(reads, repeatedReads, readHeavyPaths);

    return {
      reads,
      repeatedReads,
      readHeavyPaths,
      metrics,
      suggestions,
    };
  }

  /**
   * Detects all ledger read operations from source code.
   */
  private extractReads(sourceCode: string): LedgerReadOperation[] {
    const reads: LedgerReadOperation[] = [];
    const lines = sourceCode.split(/\r?\n/);

    let currentFunction = 'global';
    let inLoop = false;
    let loopDepth = 0;
    let braceBalance = 0;
    const loopBraceLevels: number[] = [];

    // Regex patterns for detecting function headers and loop constructs
    const fnRegex = /(?:pub\s+)?fn\s+([a-zA-Z0-9_]+)\s*\(/;
    const loopRegex = /\b(for\s+.*?\s+in\s+.*|while\s+.*|loop)\s*\{/;

    // Storage read matching regex
    // Matches patterns like env.storage().instance().get(&key) or storage().persistent().has(&DataKey::User(id))
    const readRegex = /(?:env\.)?storage\(\)\.(instance|persistent|temporary)\(\)\.(get|has|get_unchecked)\s*\(([^)]*)\)/g;
    const directReadRegex = /(?:env\.)?storage\(\)\.(get|has)\s*\(([^)]*)\)/g;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      const lineNum = i + 1;

      // Track function boundaries
      const fnMatch = trimmed.match(fnRegex);
      if (fnMatch) {
        currentFunction = fnMatch[1];
      }

      // Track loop scopes
      if (loopRegex.test(trimmed)) {
        loopDepth++;
        inLoop = true;
        loopBraceLevels.push(braceBalance);
      }

      // Count braces
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

      // 1. Check tiered storage reads: storage().instance().get(...)
      let match: RegExpExecArray | null;
      readRegex.lastIndex = 0;
      while ((match = readRegex.exec(line)) !== null) {
        const tier = match[1] as StorageTier;
        const opType = match[2] as ReadOperationType;
        const rawArg = match[3]?.trim() || '';
        const cleanKey = this.cleanKeyArgument(rawArg);

        reads.push({
          id: `read_${lineNum}_${reads.length + 1}`,
          storageTier: tier,
          opType,
          key: cleanKey || `unknown_key_L${lineNum}`,
          line: lineNum,
          column: match.index + 1,
          enclosingFunction: currentFunction,
          isInLoop,
          loopDepth,
          rawExpression: match[0],
        });
      }

      // 2. Check direct storage reads: storage().get(...)
      directReadRegex.lastIndex = 0;
      while ((match = directReadRegex.exec(line)) !== null) {
        const opType = match[1] as ReadOperationType;
        const rawArg = match[2]?.trim() || '';
        const cleanKey = this.cleanKeyArgument(rawArg);

        reads.push({
          id: `read_${lineNum}_${reads.length + 1}`,
          storageTier: 'unknown',
          opType,
          key: cleanKey || `unknown_key_L${lineNum}`,
          line: lineNum,
          column: match.index + 1,
          enclosingFunction: currentFunction,
          isInLoop,
          loopDepth,
          rawExpression: match[0],
        });
      }
    }

    return reads;
  }

  /**
   * Cleans reference tokens and whitespace from storage key expressions.
   */
  private cleanKeyArgument(rawArg: string): string {
    return rawArg
      .replace(/^&/, '')
      .replace(/&/g, '')
      .trim();
  }

  /**
   * Group and track repeated reads per function and key.
   */
  private groupRepeatedReads(reads: LedgerReadOperation[]): Map<string, LedgerReadOperation[]> {
    const grouped = new Map<string, LedgerReadOperation[]>();

    for (const read of reads) {
      const groupKey = `${read.enclosingFunction}::${read.key}`;
      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, []);
      }
      grouped.get(groupKey)!.push(read);
    }

    // Filter to only groups that have repeated accesses (> 1)
    const repeated = new Map<string, LedgerReadOperation[]>();
    for (const [key, ops] of grouped.entries()) {
      if (ops.length > 1) {
        repeated.set(key, ops);
      }
    }

    return repeated;
  }

  /**
   * Identifies read-heavy execution paths and loops.
   */
  private identifyReadHeavyPaths(reads: LedgerReadOperation[]): ReadAnalysisResult['readHeavyPaths'] {
    const fnCounts = new Map<string, { count: number; hasLoop: boolean }>();

    for (const read of reads) {
      const entry = fnCounts.get(read.enclosingFunction) || { count: 0, hasLoop: false };
      entry.count++;
      if (read.isInLoop) {
        entry.hasLoop = true;
      }
      fnCounts.set(read.enclosingFunction, entry);
    }

    const paths: ReadAnalysisResult['readHeavyPaths'] = [];

    for (const [fnName, data] of fnCounts.entries()) {
      let riskLevel: 'low' | 'medium' | 'high' = 'low';
      if (data.hasLoop || data.count >= 6) {
        riskLevel = 'high';
      } else if (data.count >= 3) {
        riskLevel = 'medium';
      }

      if (data.count >= 2 || data.hasLoop) {
        paths.push({
          functionName: fnName,
          readCount: data.count,
          hasLoopReads: data.hasLoop,
          riskLevel,
        });
      }
    }

    return paths;
  }

  /**
   * Calculate cost metrics for the reads.
   */
  private calculateMetrics(
    reads: LedgerReadOperation[],
    repeatedReads: Map<string, LedgerReadOperation[]>
  ): ReadCostMetrics {
    const uniqueKeys = new Set(reads.map((r) => r.key)).size;
    const loopReads = reads.filter((r) => r.isInLoop).length;
    let repeatedReadCount = 0;

    for (const ops of repeatedReads.values()) {
      repeatedReadCount += ops.length - 1;
    }

    return {
      totalReads: reads.length,
      uniqueKeysRead: uniqueKeys,
      repeatedReadCount,
      loopReadCount: loopReads,
      estimatedCpuInstructions: reads.length * BASE_READ_CPU_INSTRUCTIONS,
      estimatedReadEntryFeeStroops: reads.length * BASE_LEDGER_READ_FEE_STROOPS,
    };
  }

  /**
   * Generate actionable optimization suggestions based on the analysis.
   */
  private generateSuggestions(
    reads: LedgerReadOperation[],
    repeatedReads: Map<string, LedgerReadOperation[]>,
    readHeavyPaths: ReadAnalysisResult['readHeavyPaths']
  ): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];

    // 1. Suggestions for Loop Reads (High Severity)
    const loopReads = reads.filter((r) => r.isInLoop);
    for (const loopRead of loopReads) {
      suggestions.push({
        id: `OPT_READ_LOOP_${loopRead.id}`,
        title: `Ledger Read in Loop: '${loopRead.key}'`,
        description: `Ledger read operation '${loopRead.rawExpression}' is executed inside a loop in function '${loopRead.enclosingFunction}'. In Soroban, each iteration incurs entry lookup fees and CPU metering.`,
        severity: 'high',
        category: 'loop_hoisting',
        affectedKey: loopRead.key,
        line: loopRead.line,
        functionName: loopRead.enclosingFunction,
        suggestedFix: `Hoist the read for '${loopRead.key}' outside the loop into a local variable, or pre-fetch/batch ledger state before entering the loop.`,
        estimatedResourceSavings: `Saves up to ${BASE_LEDGER_READ_FEE_STROOPS * 10} stroops per transaction depending on iteration count.`,
      });
    }

    // 2. Suggestions for Repeated Reads (Medium Severity)
    for (const [groupKey, ops] of repeatedReads.entries()) {
      const [fnName, key] = groupKey.split('::');
      const lines = ops.map((o) => o.line).join(', ');
      suggestions.push({
        id: `OPT_REPEATED_READ_${fnName}_${key}`,
        title: `Repeated Storage Read: '${key}'`,
        description: `Key '${key}' is read ${ops.length} times in function '${fnName}' (lines: ${lines}). Repeated reads of unchanged ledger state cause redundant metering.`,
        severity: 'medium',
        category: 'caching',
        affectedKey: key,
        line: ops[0].line,
        functionName: fnName,
        suggestedFix: `Cache the value of '${key}' in a local 'let' binding: 'let ${key.toLowerCase()}_val = env.storage().${ops[0].storageTier}().get(&${key});'`,
        estimatedResourceSavings: `Eliminates ${ops.length - 1} redundant ledger reads (~${(ops.length - 1) * BASE_LEDGER_READ_FEE_STROOPS} stroops).`,
      });
    }

    // 3. Read Heavy Path Suggestions
    for (const path of readHeavyPaths) {
      if (path.riskLevel === 'high' && !path.hasLoopReads) {
        suggestions.push({
          id: `OPT_READ_HEAVY_${path.functionName}`,
          title: `Read-Heavy Function: '${path.functionName}'`,
          description: `Function '${path.functionName}' executes ${path.readCount} ledger reads across its execution path.`,
          severity: 'medium',
          category: 'batching',
          functionName: path.functionName,
          suggestedFix: `Consider aggregating related storage keys into a single composite struct or batching read calls to reduce ledger access footprint.`,
          estimatedResourceSavings: `Reduces read entry count and footprint size.`,
        });
      }
    }

    return suggestions;
  }
}
