export type StorageTier = 'instance' | 'persistent' | 'temporary' | 'unknown';

export type ReadOperationType = 'get' | 'has' | 'get_unchecked' | 'load';

export type WriteOperationType = 'set' | 'remove' | 'store' | 'update';

export interface LedgerReadOperation {
  id: string;
  storageTier: StorageTier;
  opType: ReadOperationType;
  key: string;
  line: number;
  column?: number;
  enclosingFunction: string;
  isInLoop: boolean;
  loopDepth: number;
  rawExpression: string;
}

export interface LedgerWriteOperation {
  id: string;
  storageTier: StorageTier;
  opType: WriteOperationType;
  key: string;
  valueExpression?: string;
  line: number;
  column?: number;
  enclosingFunction: string;
  isInLoop: boolean;
  loopDepth: number;
  rawExpression: string;
}

export interface OptimizationSuggestion {
  id: string;
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: 'caching' | 'batching' | 'loop_hoisting' | 'redundant_mutation' | 'storage_tier';
  affectedKey?: string;
  line?: number;
  functionName?: string;
  suggestedFix: string;
  estimatedResourceSavings?: string;
}

export interface ReadCostMetrics {
  totalReads: number;
  uniqueKeysRead: number;
  repeatedReadCount: number;
  loopReadCount: number;
  estimatedCpuInstructions: number;
  estimatedReadEntryFeeStroops: number;
}

export interface WriteCostMetrics {
  totalWrites: number;
  uniqueKeysWritten: number;
  repeatedWriteCount: number;
  loopWriteCount: number;
  unnecessaryMutationCount: number;
  estimatedCpuInstructions: number;
  estimatedWriteEntryFeeStroops: number;
}

export interface ReadAnalysisResult {
  reads: LedgerReadOperation[];
  repeatedReads: Map<string, LedgerReadOperation[]>;
  readHeavyPaths: {
    functionName: string;
    readCount: number;
    hasLoopReads: boolean;
    riskLevel: 'low' | 'medium' | 'high';
  }[];
  metrics: ReadCostMetrics;
  suggestions: OptimizationSuggestion[];
}

export interface WriteAnalysisResult {
  writes: LedgerWriteOperation[];
  repeatedWrites: Map<string, LedgerWriteOperation[]>;
  unnecessaryMutations: {
    key: string;
    reason: string;
    occurrences: LedgerWriteOperation[];
  }[];
  highImpactPatterns: {
    functionName: string;
    writeCount: number;
    hasLoopWrites: boolean;
    riskLevel: 'low' | 'medium' | 'high';
    description: string;
  }[];
  metrics: WriteCostMetrics;
  suggestions: OptimizationSuggestion[];
}

export interface LedgerCostAnalysisReport {
  readAnalysis: ReadAnalysisResult;
  writeAnalysis: WriteAnalysisResult;
  totalEstimatedStroops: number;
  summary: {
    totalOperations: number;
    highSeverityIssues: number;
    totalSavingsPotential: string;
  };
}
