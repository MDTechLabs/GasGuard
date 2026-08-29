import { createHash } from 'crypto';
import { ContractFingerprint, DuplicateMatch, FingerprintReport } from './types';

export class SorobanContractFingerprinter {
  private registry: Map<string, ContractFingerprint> = new Map();

  fingerprint(source: string, filePath: string): ContractFingerprint {
    const contractName = this.extractContractName(source);
    const normalized = this.normalizeSource(source);
    const fingerprint = this.hash(normalized);
    const structuralHash = this.hash(this.extractStructure(source));
    const functionCount = (source.match(/\bfn\s+\w+/g) ?? []).length;

    const entry: ContractFingerprint = {
      contractName,
      filePath,
      fingerprint,
      structuralHash,
      functionCount,
      sourceLength: source.length,
      createdAt: new Date(),
    };

    this.registry.set(filePath, entry);
    return entry;
  }

  detectDuplicates(): DuplicateMatch[] {
    const entries = Array.from(this.registry.values());
    const duplicates: DuplicateMatch[] = [];

    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i];
        const b = entries[j];
        if (a.fingerprint === b.fingerprint) {
          duplicates.push({ original: a, duplicate: b, similarity: 'exact' });
        } else if (a.structuralHash === b.structuralHash) {
          duplicates.push({ original: a, duplicate: b, similarity: 'structural' });
        }
      }
    }

    return duplicates;
  }

  generateReport(): FingerprintReport {
    const fingerprints = Array.from(this.registry.values());
    const duplicates = this.detectDuplicates();
    const duplicateFiles = new Set(duplicates.map((d) => d.duplicate.filePath));

    return {
      fingerprints,
      duplicates,
      uniqueCount: fingerprints.filter((f) => !duplicateFiles.has(f.filePath)).length,
      duplicateCount: duplicateFiles.size,
      generatedAt: new Date(),
    };
  }

  clear(): void {
    this.registry.clear();
  }

  private hash(input: string): string {
    return createHash('sha256').update(input).digest('hex');
  }

  private normalizeSource(source: string): string {
    return source.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').trim();
  }

  private extractStructure(source: string): string {
    // Keep only fn signatures and struct/impl declarations for structural comparison
    return source
      .split('\n')
      .filter((l) => /^\s*(pub\s+)?(?:fn|struct|impl|trait|enum)\s/.test(l))
      .join('\n');
  }

  private extractContractName(source: string): string {
    const match = source.match(/(?:impl|struct)\s+(\w+)/);
    return match?.[1] ?? 'UnknownContract';
  }
}
