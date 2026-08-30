export type LedgerAccessType = 'read' | 'write' | 'has' | 'delete' | 'extend_ttl';

export type LedgerStorageTier = 'persistent' | 'instance' | 'temporary';

export interface LedgerAccessEntry {
  id: string;
  key?: string;
  storageTier: LedgerStorageTier;
  accessType: LedgerAccessType;
  line: number;
  column?: number;
  inLoop: boolean;
  functionName?: string;
  codeSnippet?: string;
}

export interface RepeatedAccessGroup {
  key: string;
  storageTier: LedgerStorageTier;
  count: number;
  accesses: LedgerAccessEntry[];
  hasWriteAfterRead: boolean;
  redundantReadsCount: number;
}

export interface LedgerAccessMetrics {
  totalReads: number;
  totalWrites: number;
  totalDeletes: number;
  persistentAccesses: number;
  instanceAccesses: number;
  temporaryAccesses: number;
  repeatedReads: number;
  repeatedWrites: number;
  loopAccesses: number;
  uniqueKeysAccessed: number;
  estimatedFootprintBytes: number;
}

export interface LedgerAccessFinding {
  ruleId: string;
  severity: 'high' | 'medium' | 'low';
  message: string;
  line: number;
  key?: string;
  recommendation: string;
  estimatedSavings?: string;
}

export interface LedgerAnalysisResult {
  contractPath: string;
  accesses: LedgerAccessEntry[];
  repeatedAccesses: RepeatedAccessGroup[];
  findings: LedgerAccessFinding[];
  metrics: LedgerAccessMetrics;
}
