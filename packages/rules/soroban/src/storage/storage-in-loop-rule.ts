/**
 * Rule: soroban-storage-in-loop (#875)
 * Detects storage read/write operations executed repeatedly inside loops.
 */
import {
  detectStorageInLoops,
  StorageInLoopSite,
  StorageOpType,
  StorageScope,
} from '../../../../analyzers/soroban/storage/storage-in-loop-analyzer';

export interface StorageInLoopFinding {
  ruleId: 'soroban-storage-in-loop';
  line: number;
  message: string;
  suggestion: string;
  severity: 'critical' | 'high' | 'medium';
  opType: StorageOpType;
  scope: StorageScope;
  key: string;
  boundType: string;
  estimatedCpuInstructions: number;
}

export function detectStorageAccessInsideLoops(source: string): StorageInLoopFinding[] {
  const sites = detectStorageInLoops(source);
  return sites.map((s: StorageInLoopSite) => ({
    ruleId: 'soroban-storage-in-loop' as const,
    line: s.line,
    message: s.message,
    suggestion: s.suggestion,
    severity: s.severity,
    opType: s.opType,
    scope: s.scope,
    key: s.key,
    boundType: s.loopContext.boundType,
    estimatedCpuInstructions: s.estimatedResourceImpact.cpuInstructions,
  }));
}
