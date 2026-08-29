/**
 * Soroban Incremental Scan Engine
 *
 * Detects changed files and reuses previous scan results for unchanged files,
 * minimizing scan duration for large Soroban contract repositories.
 */

import { createHash } from "crypto";

export interface ScanInput {
  filePath: string;
  source: string;
}

export interface ScanFinding {
  ruleId: string;
  message: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  line: number;
}

export interface FileScanResult {
  filePath: string;
  findings: ScanFinding[];
  scannedAt: number;
}

export interface IncrementalScanResult {
  results: FileScanResult[];
  scanned: string[];
  skipped: string[];
  cacheHitRate: number;
  durationMs: number;
}

type ScanFn = (input: ScanInput) => ScanFinding[];

interface CacheEntry {
  contentHash: string;
  result: FileScanResult;
}

export class StellarIncrementalScanEngine {
  private cache = new Map<string, CacheEntry>();

  private static hash(source: string): string {
    return createHash("sha256").update(source).digest("hex");
  }

  /**
   * Run an incremental scan. Only files whose content has changed since the
   * last run are re-scanned; results for unchanged files are served from cache.
   */
  scan(inputs: ScanInput[], scanFn: ScanFn): IncrementalScanResult {
    const start = Date.now();
    const results: FileScanResult[] = [];
    const scanned: string[] = [];
    const skipped: string[] = [];

    for (const input of inputs) {
      const hash = StellarIncrementalScanEngine.hash(input.source);
      const cached = this.cache.get(input.filePath);

      if (cached && cached.contentHash === hash) {
        results.push(cached.result);
        skipped.push(input.filePath);
      } else {
        const findings = scanFn(input);
        const result: FileScanResult = {
          filePath: input.filePath,
          findings,
          scannedAt: Date.now(),
        };
        this.cache.set(input.filePath, { contentHash: hash, result });
        results.push(result);
        scanned.push(input.filePath);
      }
    }

    const total = inputs.length;
    return {
      results,
      scanned,
      skipped,
      cacheHitRate: total > 0 ? skipped.length / total : 0,
      durationMs: Date.now() - start,
    };
  }

  /** Force a file to be rescanned on the next run. */
  invalidate(filePath: string): void {
    this.cache.delete(filePath);
  }

  /** Clear all cached results. */
  clearCache(): void {
    this.cache.clear();
  }

  /** Number of files currently tracked in the cache. */
  get trackedCount(): number {
    return this.cache.size;
  }
}
