/**
 * Issue #894 — Soroban Footprint Size Warning Rule
 *
 * Configurable thresholds for ledger entry footprints (reads/writes),
 * calculates footprint size, assigns severity, and generates actionable optimization recommendations.
 */

import {
  maskNonCode,
  extractFunctions,
} from '../common/source-utils';

export interface FootprintThresholdConfig {
  maxReadKeys: number;
  maxWriteKeys: number;
  maxTotalKeys: number;
}

export const DEFAULT_FOOTPRINT_CONFIG: FootprintThresholdConfig = {
  maxReadKeys: 10,
  maxWriteKeys: 5,
  maxTotalKeys: 12,
};

export interface FootprintAnalysis {
  caller: string;
  line: number;
  readKeysCount: number;
  writeKeysCount: number;
  totalKeysCount: number;
  exceedsThreshold: boolean;
}

export interface FootprintFinding {
  ruleId: 'soroban-footprint-size';
  severity: 'critical' | 'high' | 'medium' | 'low';
  line: number;
  message: string;
  recommendation: string;
  metrics: {
    reads: number;
    writes: number;
    total: number;
    maxAllowed: number;
  };
}

export interface FootprintReport {
  analyses: FootprintAnalysis[];
  findings: FootprintFinding[];
  metrics: {
    totalFunctionsAnalyzed: number;
    excessiveFootprintFunctions: number;
    maxFootprintEncountered: number;
  };
}

export function analyzeFootprintSize(
  source: string,
  config: FootprintThresholdConfig = DEFAULT_FOOTPRINT_CONFIG,
): FootprintReport {
  const masked = maskNonCode(source);
  const functions = extractFunctions(masked, source);

  const analyses: FootprintAnalysis[] = [];
  const findings: FootprintFinding[] = [];

  let excessiveFootprintFunctions = 0;
  let maxFootprintEncountered = 0;

  for (const fn of functions) {
    const fnBody = source.slice(fn.bodyStart, fn.bodyEnd);

    // Count storage operations
    const getCount = (fnBody.match(/\.get\s*\(/g) || []).length;
    const hasCount = (fnBody.match(/\.has\s*\(/g) || []).length;
    const setCount = (fnBody.match(/\.set\s*\(/g) || []).length;
    const putCount = (fnBody.match(/\.put\s*\(/g) || []).length;
    const removeCount = (fnBody.match(/\.remove\s*\(/g) || []).length;

    const instanceCount = (fnBody.match(/env\s*\.\s*storage\s*\(\s*\)\s*\.\s*instance\s*\(\s*\)/g) || []).length;
    const persistentCount = (fnBody.match(/env\s*\.\s*storage\s*\(\s*\)\s*\.\s*persistent\s*\(\s*\)/g) || []).length;
    const temporaryCount = (fnBody.match(/env\s*\.\s*storage\s*\(\s*\)\s*\.\s*temporary\s*\(\s*\)/g) || []).length;

    const readKeysCount = getCount + hasCount + (instanceCount > 0 ? 1 : 0);
    const writeKeysCount = setCount + putCount + removeCount;

    // Instance + persistent + temporary access count toward footprint overhead
    const storageOverhead = (persistentCount > 1 ? persistentCount - 1 : 0) + (temporaryCount > 1 ? temporaryCount - 1 : 0);
    const totalKeysCount = readKeysCount + writeKeysCount + storageOverhead;

    if (totalKeysCount > maxFootprintEncountered) {
      maxFootprintEncountered = totalKeysCount;
    }

    const exceedsThreshold =
      readKeysCount > config.maxReadKeys ||
      writeKeysCount > config.maxWriteKeys ||
      totalKeysCount > config.maxTotalKeys;

    analyses.push({
      caller: fn.name,
      line: fn.line,
      readKeysCount,
      writeKeysCount,
      totalKeysCount,
      exceedsThreshold,
    });

    if (exceedsThreshold) {
      excessiveFootprintFunctions++;

      const severity =
        totalKeysCount > config.maxTotalKeys * 2
          ? 'critical'
          : totalKeysCount > config.maxTotalKeys * 1.5
          ? 'high'
          : 'medium';

      findings.push({
        ruleId: 'soroban-footprint-size',
        severity,
        line: fn.line,
        message: `Function '${fn.name}' generates an unusually large ledger footprint (${totalKeysCount} keys: ${readKeysCount} reads, ${writeKeysCount} writes), exceeding maximum threshold (${config.maxTotalKeys}).`,
        recommendation:
          'Pack related state attributes into a single struct, utilize instance storage for hot variables, or divide state-heavy operations into batched calls to reduce ledger footprint size and fee bounds.',
        metrics: {
          reads: readKeysCount,
          writes: writeKeysCount,
          total: totalKeysCount,
          maxAllowed: config.maxTotalKeys,
        },
      });
    }
  }

  return {
    analyses,
    findings,
    metrics: {
      totalFunctionsAnalyzed: functions.length,
      excessiveFootprintFunctions,
      maxFootprintEncountered,
    },
  };
}
