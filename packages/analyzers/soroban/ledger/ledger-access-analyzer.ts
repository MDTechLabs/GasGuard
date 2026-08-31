import {
  LedgerAccessEntry,
  LedgerAccessFinding,
  LedgerAccessMetrics,
  LedgerAccessType,
  LedgerAnalysisResult,
  LedgerStorageTier,
  RepeatedAccessGroup,
} from './types';

export class SorobanLedgerAccessAnalyzer {
  private readonly logger = {
    debug: (_msg: string) => {},
    warn: (_msg: string) => {},
    error: (_msg: string) => {},
  };

  /**
   * Analyzes Soroban contract source code for ledger access patterns,
   * classifying reads/writes, detecting repeated accesses, and computing metrics.
   */
  public analyze(sourceCode: string, contractPath: string = 'contract.rs'): LedgerAnalysisResult {
    this.logger.debug(`Analyzing ledger access patterns for contract: ${contractPath}`);

    const accesses: LedgerAccessEntry[] = [];
    const lines = sourceCode.split('\n');

    let currentFunction: string | undefined;
    let loopDepth = 0;

    // Track variable-to-key symbol definitions (e.g. let ADMIN = Symbol::new(&env, "admin"))
    const symbolMap = new Map<string, string>();
    for (const line of lines) {
      const symMatch = line.match(/(?:let|const)\s+([a-zA-Z0-9_]+)\s*=\s*(?:Symbol::new|symbol_short!)\s*\(&?env,\s*"([^"]+)"\)/);
      if (symMatch) {
        symbolMap.set(symMatch[1], symMatch[2]);
      }
    }

    // Scan lines for function boundaries, loops, and ledger accesses
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      const lineNumber = i + 1;

      // Track function context
      const fnMatch = line.match(/(?:pub\s+)?fn\s+([a-zA-Z0-9_]+)\s*\(/);
      if (fnMatch) {
        currentFunction = fnMatch[1];
      }

      // Track loop depth
      if (
        line.includes('for ') ||
        line.includes('while ') ||
        line.includes('loop {') ||
        line.includes('.for_each(') ||
        line.includes('.iter()')
      ) {
        loopDepth++;
      }
      if (line.includes('}') && loopDepth > 0 && !line.includes('{')) {
        loopDepth = Math.max(0, loopDepth - 1);
      }

      // Detect storage tier calls
      if (line.includes('env.storage()') || line.includes('.storage().')) {
        let storageTier: LedgerStorageTier = 'persistent';
        if (line.includes('.instance()')) {
          storageTier = 'instance';
        } else if (line.includes('.temporary()')) {
          storageTier = 'temporary';
        } else if (line.includes('.persistent()')) {
          storageTier = 'persistent';
        }

        // Classify access type
        let accessType: LedgerAccessType | undefined;
        if (line.includes('.get(') || line.includes('.get_unchecked(')) {
          accessType = 'read';
        } else if (line.includes('.has(')) {
          accessType = 'has';
        } else if (line.includes('.set(') || line.includes('.put(') || line.includes('.update(')) {
          accessType = 'write';
        } else if (line.includes('.remove(') || line.includes('.delete(')) {
          accessType = 'delete';
        } else if (line.includes('.extend_ttl(')) {
          accessType = 'extend_ttl';
        }

        if (accessType) {
          // Extract key name
          let keyName = this.extractKeyName(line, symbolMap);

          accesses.push({
            id: `access-${accesses.length + 1}`,
            key: keyName,
            storageTier,
            accessType,
            line: lineNumber,
            inLoop: loopDepth > 0,
            functionName: currentFunction,
            codeSnippet: trimmed,
          });
        }
      }
    }

    // Group repeated accesses
    const repeatedAccesses = this.groupRepeatedAccesses(accesses);

    // Compute metrics
    const metrics = this.computeMetrics(accesses, repeatedAccesses);

    // Generate diagnostic findings
    const findings = this.generateFindings(accesses, repeatedAccesses);

    return {
      contractPath,
      accesses,
      repeatedAccesses,
      findings,
      metrics,
    };
  }

  private extractKeyName(line: string, symbolMap: Map<string, string>): string {
    // Check for inline Symbol::new(&env, "key")
    const symbolMatch = line.match(/(?:Symbol::new|symbol_short!)\s*\(&?env,\s*"([^"]+)"\)/);
    if (symbolMatch && symbolMatch[1]) {
      return symbolMatch[1];
    }

    // Check for DataKey enum variant: DataKey::User(addr), DataKey::Admin
    const enumMatch = line.match(/&?DataKey::([a-zA-Z0-9_]+)(?:\(([^)]+)\))?/);
    if (enumMatch) {
      return enumMatch[2] ? `DataKey::${enumMatch[1]}(${enumMatch[2]})` : `DataKey::${enumMatch[1]}`;
    }

    // Check for variable reference &var or var
    const methodArgsMatch = line.match(/\.(?:get|has|set|remove|extend_ttl)\s*\(\s*&?([a-zA-Z0-9_]+)/);
    if (methodArgsMatch && methodArgsMatch[1]) {
      const varName = methodArgsMatch[1];
      return symbolMap.get(varName) ?? varName;
    }

    return 'unknown_key';
  }

  private groupRepeatedAccesses(accesses: LedgerAccessEntry[]): RepeatedAccessGroup[] {
    const keyMap = new Map<string, LedgerAccessEntry[]>();

    for (const acc of accesses) {
      if (!acc.key || acc.key === 'unknown_key') continue;
      const groupKey = `${acc.storageTier}:${acc.key}`;
      if (!keyMap.has(groupKey)) {
        keyMap.set(groupKey, []);
      }
      keyMap.get(groupKey)!.push(acc);
    }

    const groups: RepeatedAccessGroup[] = [];

    for (const [groupKey, entries] of keyMap.entries()) {
      if (entries.length > 1) {
        const [tier, ...keyParts] = groupKey.split(':');
        const key = keyParts.join(':');

        let readsCount = 0;
        let writesCount = 0;
        let hasWriteAfterRead = false;

        for (const entry of entries) {
          if (entry.accessType === 'read' || entry.accessType === 'has') {
            readsCount++;
          } else if (entry.accessType === 'write') {
            writesCount++;
            if (readsCount > 0) {
              hasWriteAfterRead = true;
            }
          }
        }

        groups.push({
          key,
          storageTier: tier as LedgerStorageTier,
          count: entries.length,
          accesses: entries,
          hasWriteAfterRead,
          redundantReadsCount: Math.max(0, readsCount - 1),
        });
      }
    }

    return groups;
  }

  private computeMetrics(
    accesses: LedgerAccessEntry[],
    repeatedGroups: RepeatedAccessGroup[],
  ): LedgerAccessMetrics {
    let totalReads = 0;
    let totalWrites = 0;
    let totalDeletes = 0;
    let persistentAccesses = 0;
    let instanceAccesses = 0;
    let temporaryAccesses = 0;
    let loopAccesses = 0;

    const uniqueKeys = new Set<string>();

    for (const acc of accesses) {
      if (acc.accessType === 'read' || acc.accessType === 'has') {
        totalReads++;
      } else if (acc.accessType === 'write') {
        totalWrites++;
      } else if (acc.accessType === 'delete') {
        totalDeletes++;
      }

      if (acc.storageTier === 'persistent') persistentAccesses++;
      else if (acc.storageTier === 'instance') instanceAccesses++;
      else if (acc.storageTier === 'temporary') temporaryAccesses++;

      if (acc.inLoop) loopAccesses++;
      if (acc.key) uniqueKeys.add(acc.key);
    }

    let repeatedReads = 0;
    let repeatedWrites = 0;

    for (const g of repeatedGroups) {
      repeatedReads += g.redundantReadsCount;
      const writes = g.accesses.filter((a) => a.accessType === 'write').length;
      if (writes > 1) {
        repeatedWrites += writes - 1;
      }
    }

    // Footprint estimation: base 64 bytes per unique key + 128 bytes per persistent entry
    const estimatedFootprintBytes = uniqueKeys.size * 64 + persistentAccesses * 128;

    return {
      totalReads,
      totalWrites,
      totalDeletes,
      persistentAccesses,
      instanceAccesses,
      temporaryAccesses,
      repeatedReads,
      repeatedWrites,
      loopAccesses,
      uniqueKeysAccessed: uniqueKeys.size,
      estimatedFootprintBytes,
    };
  }

  private generateFindings(
    accesses: LedgerAccessEntry[],
    repeatedGroups: RepeatedAccessGroup[],
  ): LedgerAccessFinding[] {
    const findings: LedgerAccessFinding[] = [];

    // Finding 1: Repeated Reads of Same Key
    for (const group of repeatedGroups) {
      if (group.redundantReadsCount > 0) {
        const firstRead = group.accesses.find((a) => a.accessType === 'read' || a.accessType === 'has');
        findings.push({
          ruleId: 'SOROBAN-LEDGER-01',
          severity: 'medium',
          line: firstRead?.line ?? 1,
          key: group.key,
          message: `Repeated ledger read detected for key '${group.key}' (${group.redundantReadsCount + 1} reads in same execution flow).`,
          recommendation: `Cache the ledger entry in a local variable instead of querying env.storage().${group.storageTier}().get('${group.key}') multiple times.`,
          estimatedSavings: `Saves ~${group.redundantReadsCount * 120} CPU & Read CPU budget instructions`,
        });
      }

      // Finding 2: Repeated Writes of Same Key
      const writes = group.accesses.filter((a) => a.accessType === 'write');
      if (writes.length > 1) {
        findings.push({
          ruleId: 'SOROBAN-LEDGER-02',
          severity: 'high',
          line: writes[1].line,
          key: group.key,
          message: `Multiple ledger writes detected for key '${group.key}' (${writes.length} writes in single transaction).`,
          recommendation: `Aggregate state mutations in memory and perform a single write at the end of the transaction.`,
          estimatedSavings: `Saves ~${(writes.length - 1) * 500} Ledger Write fee units`,
        });
      }
    }

    // Finding 3: Ledger Access inside Loops
    for (const acc of accesses) {
      if (acc.inLoop) {
        findings.push({
          ruleId: 'SOROBAN-LEDGER-03',
          severity: acc.accessType === 'write' ? 'high' : 'medium',
          line: acc.line,
          key: acc.key,
          message: `Ledger ${acc.accessType} operation executed inside a loop structure for key '${acc.key ?? 'entry'}'.`,
          recommendation: `Extract ledger interactions outside the loop by batch reading or accumulating updates in a vector/map before writing once.`,
          estimatedSavings: 'Significant reduction in CPU instruction count and ledger write fees',
        });
      }
    }

    return findings;
  }
}
