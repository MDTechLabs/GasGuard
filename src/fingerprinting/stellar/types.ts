export interface ContractFingerprint {
  contractName: string;
  filePath: string;
  fingerprint: string;
  structuralHash: string;
  functionCount: number;
  sourceLength: number;
  createdAt: Date;
}

export interface DuplicateMatch {
  original: ContractFingerprint;
  duplicate: ContractFingerprint;
  similarity: 'exact' | 'structural';
}

export interface FingerprintReport {
  fingerprints: ContractFingerprint[];
  duplicates: DuplicateMatch[];
  uniqueCount: number;
  duplicateCount: number;
  generatedAt: Date;
}
