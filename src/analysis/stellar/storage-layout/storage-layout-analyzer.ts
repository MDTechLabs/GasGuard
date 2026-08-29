export interface StorageLayoutEntry {
  name: string;
  type: string;
  slot: number;
  offset: number;
  kind: 'instance' | 'persistent' | 'temporary';
  lineNumber: number;
}

export interface StorageLayoutWarning {
  message: string;
  lineNumber: number;
  severity: 'low' | 'medium' | 'high';
}

export interface StorageLayoutReport {
  contractName: string;
  entries: StorageLayoutEntry[];
  warnings: StorageLayoutWarning[];
  summary: string;
}

interface RawStorageOp {
  name: string;
  kind: 'instance' | 'persistent' | 'temporary';
  lineNumber: number;
}

export class SorobanStorageLayoutAnalyzer {
  private source: string;
  private filePath: string;

  constructor(source: string, filePath: string) {
    this.source = source;
    this.filePath = filePath;
  }

  analyze(): StorageLayoutReport {
    const contractName = this.extractContractName();
    const rawOps = this.collectStorageOps();
    const entries = this.deduplicateEntries(rawOps);
    const warnings = this.analyzeLayoutWarnings(rawOps, entries);

    return {
      contractName,
      entries,
      warnings,
      summary: this.buildSummary(contractName, entries, warnings),
    };
  }

  private extractContractName(): string {
    const match = this.source.match(/(?:pub\s+)?struct\s+(\w+)/);
    return match ? match[1] : 'UnknownContract';
  }

  private collectStorageOps(): RawStorageOp[] {
    const ops: RawStorageOp[] = [];
    const setPattern = /(?:env\.)?storage\(\)\.(\w+)\(\)\.set\s*\(\s*(?:&)?(?:Symbol::new\s*\([^,]+,\s*"([^"]+)"\)|([A-Za-z_]\w*))\s*,/g;
    let match: RegExpExecArray | null;

    while ((match = setPattern.exec(this.source)) !== null) {
      const kind = match[1] as 'instance' | 'persistent' | 'temporary';
      const name = match[2] || match[3] || 'unknown';
      ops.push({ name, kind, lineNumber: this.getLineNumber(match.index) });
    }

    return ops;
  }

  private deduplicateEntries(ops: RawStorageOp[]): StorageLayoutEntry[] {
    const seen = new Set<string>();
    return ops.filter(op => {
      const key = `${op.kind}:${op.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map((op, idx) => ({
      name: op.name,
      type: this.inferType(op.name),
      slot: idx,
      offset: 0,
      kind: op.kind,
      lineNumber: op.lineNumber,
    }));
  }

  private inferType(keyName: string): string {
    const typeHints: Record<string, string> = {
      count: 'u32',
      balance: 'i128',
      owner: 'Address',
      admin: 'Address',
      total_supply: 'i128',
      name: 'String',
      symbol: 'Symbol',
      paused: 'bool',
    };
    return typeHints[keyName] || 'unknown';
  }

  private analyzeLayoutWarnings(rawOps: RawStorageOp[], entries: StorageLayoutEntry[]): StorageLayoutWarning[] {
    const warnings: StorageLayoutWarning[] = [];
    const seen = new Map<string, number>();

    for (const op of rawOps) {
      const key = `${op.kind}:${op.name}`;
      if (seen.has(key)) {
        warnings.push({
          message: `Duplicate storage key '${op.name}' found in '${op.kind}' storage.`,
          lineNumber: op.lineNumber,
          severity: 'high',
        });
      }
      seen.set(key, (seen.get(key) || 0) + 1);
    }

    for (const entry of entries) {
      if (entry.type === 'unknown') {
        warnings.push({
          message: `Storage key '${entry.name}' has unknown type. Consider adding explicit type annotations.`,
          lineNumber: entry.lineNumber,
          severity: 'low',
        });
      }

      if (entry.kind === 'persistent' && entry.name.startsWith('tmp_')) {
        warnings.push({
          message: `Persistent storage key '${entry.name}' uses 'tmp_' prefix. Consider using temporary storage instead.`,
          lineNumber: entry.lineNumber,
          severity: 'medium',
        });
      }
    }

    if (entries.length === 0) {
      warnings.push({
        message: 'No storage entries detected. Contract may not use persistent state.',
        lineNumber: 1,
        severity: 'low',
      });
    }

    return warnings;
  }

  private buildSummary(
    contractName: string,
    entries: StorageLayoutEntry[],
    warnings: StorageLayoutWarning[],
  ): string {
    const instanceCount = entries.filter(e => e.kind === 'instance').length;
    const persistentCount = entries.filter(e => e.kind === 'persistent').length;
    const temporaryCount = entries.filter(e => e.kind === 'temporary').length;

    return (
      `${contractName} storage layout: ${entries.length} key(s) ` +
      `(${instanceCount} instance, ${persistentCount} persistent, ${temporaryCount} temporary) ` +
      `with ${warnings.length} warning(s).`
    );
  }

  private getLineNumber(offset: number): number {
    return (this.source.slice(0, offset).match(/\n/g) ?? []).length + 1;
  }
}
