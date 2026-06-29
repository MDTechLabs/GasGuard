/**
 * Soroban Scan History Manager
 *
 * Manages storage, retrieval, and filtering of Soroban contract scan history.
 * Provides functionality to track analysis results over time.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  SorobanScanRecord,
  SorobanScanMetadata,
  SorobanScanFilter,
  SorobanScanSortOptions,
  SorobanScanQueryOptions,
  SorobanScanQueryResult,
  SorobanScanComparison,
  SorobanScanHistoryStorageConfig,
} from './types';
import { SorobanAnalysisResult, SorobanScanDiff } from '../../../diffing/stellar/types';
import { SorobanResultDiffer } from '../../../diffing/stellar/soroban-result-differ';

export class SorobanScanHistoryManager {
  private scans: Map<string, SorobanScanRecord> = new Map();
  private config: SorobanScanHistoryStorageConfig;
  private storagePath: string;
  private differ: SorobanResultDiffer;

  constructor(config?: SorobanScanHistoryStorageConfig) {
    this.config = {
      maxScansPerContract: 100,
      maxScanAgeMs: 365 * 24 * 60 * 60 * 1000, // 1 year
      storageDirectory: config?.storageDirectory || path.join(process.cwd(), '.gasguard', 'scan-history'),
      enableCompression: true,
      ...config,
    };
    this.storagePath = this.config.storageDirectory!;
    this.differ = new SorobanResultDiffer();
    this.ensureStorageDirectory();
    this.loadFromDisk();
  }

  /**
   * Add a new scan record to history
   */
  addScan(
    contractName: string,
    filePath: string,
    networkPassphrase: string,
    networkUrl: string,
    results: SorobanAnalysisResult[],
    options?: {
      ledgerSequence?: number;
      durationMs?: number;
      description?: string;
      tags?: string[];
    }
  ): SorobanScanRecord {
    const scanId = crypto.randomUUID();
    const timestamp = Date.now();

    // Calculate severity breakdown
    const severityBreakdown = {
      error: results.filter(r => r.severity === 'error').length,
      warning: results.filter(r => r.severity === 'warning').length,
      info: results.filter(r => r.severity === 'info').length,
    };

    // Calculate category breakdown
    const categoryBreakdown: Record<string, number> = {};
    results.forEach(result => {
      categoryBreakdown[result.category] = (categoryBreakdown[result.category] || 0) + 1;
    });

    const metadata: SorobanScanMetadata = {
      scanId,
      timestamp,
      contractName,
      filePath,
      networkPassphrase,
      networkUrl,
      ledgerSequence: options?.ledgerSequence,
      totalIssues: results.length,
      severityBreakdown,
      categoryBreakdown,
      durationMs: options?.durationMs || 0,
      description: options?.description,
      tags: options?.tags,
      version: '1.0.0',
    };

    const scanRecord: SorobanScanRecord = {
      ...metadata,
      results,
    };

    this.scans.set(scanId, scanRecord);
    this.enforceRetentionPolicy(contractName);
    this.saveToDisk();

    return scanRecord;
  }

  /**
   * Retrieve a scan by ID
   */
  getScan(scanId: string): SorobanScanRecord | undefined {
    return this.scans.get(scanId);
  }

  /**
   * Get scan metadata without full results
   */
  getScanMetadata(scanId: string): SorobanScanMetadata | undefined {
    const scan = this.scans.get(scanId);
    if (!scan) return undefined;
    const { results, ...metadata } = scan;
    return metadata;
  }

  /**
   * Query scan history with filters and sorting
   */
  queryScans(options: SorobanScanQueryOptions = {}): SorobanScanQueryResult {
    const startTime = Date.now();
    let filteredScans = Array.from(this.scans.values());

    // Apply filters
    if (options.filter) {
      filteredScans = this.applyFilters(filteredScans, options.filter);
    }

    const totalCount = filteredScans.length;

    // Apply sorting
    if (options.sort) {
      filteredScans = this.applySorting(filteredScans, options.sort);
    }

    // Apply pagination
    if (options.offset) {
      filteredScans = filteredScans.slice(options.offset);
    }
    if (options.limit) {
      filteredScans = filteredScans.slice(0, options.limit);
    }

    // Optionally exclude full results
    if (!options.includeResults) {
      filteredScans = filteredScans.map(scan => {
        const { results, ...metadata } = scan;
        return { ...metadata, results: [] } as SorobanScanRecord;
      });
    }

    const queryDurationMs = Date.now() - startTime;

    return {
      scans: filteredScans,
      totalCount,
      queryDurationMs,
    };
  }

  /**
   * Get all scans for a specific contract
   */
  getScansByContract(contractName: string, includeResults = false): SorobanScanRecord[] {
    return this.queryScans({
      filter: { contractName },
      includeResults,
      sort: { sortBy: 'timestamp', sortOrder: 'desc' },
    }).scans;
  }

  /**
   * Get the most recent scan for a contract
   */
  getLatestScan(contractName: string): SorobanScanRecord | undefined {
    const scans = this.getScansByContract(contractName, true);
    return scans.length > 0 ? scans[0] : undefined;
  }

  /**
   * Compare two scans
   */
  compareScans(scanId1: string, scanId2: string): SorobanScanComparison | undefined {
    const scan1 = this.scans.get(scanId1);
    const scan2 = this.scans.get(scanId2);

    if (!scan1 || !scan2) return undefined;

    const diff = this.differ.diff(scan1.results, scan2.results);
    const timeElapsedMs = Math.abs(scan2.timestamp - scan1.timestamp);

    // Ensure scan1 is the earlier scan
    const [previousScan, currentScan] = scan1.timestamp < scan2.timestamp
      ? [scan1, scan2]
      : [scan2, scan1];

    return {
      previousScan,
      currentScan,
      diff,
      timeElapsedMs,
    };
  }

  /**
   * Compare latest scan with previous scan for a contract
   */
  compareLatestWithPrevious(contractName: string): SorobanScanComparison | undefined {
    const scans = this.getScansByContract(contractName, true);
    if (scans.length < 2) return undefined;

    return this.compareScans(scans[1].scanId, scans[0].scanId);
  }

  /**
   * Delete a scan from history
   */
  deleteScan(scanId: string): boolean {
    const deleted = this.scans.delete(scanId);
    if (deleted) {
      this.saveToDisk();
    }
    return deleted;
  }

  /**
   * Delete all scans for a contract
   */
  deleteScansByContract(contractName: string): number {
    let deletedCount = 0;
    for (const [scanId, scan] of this.scans.entries()) {
      if (scan.contractName === contractName) {
        this.scans.delete(scanId);
        deletedCount++;
      }
    }
    if (deletedCount > 0) {
      this.saveToDisk();
    }
    return deletedCount;
  }

  /**
   * Clear all scan history
   */
  clearHistory(): void {
    this.scans.clear();
    this.saveToDisk();
  }

  /**
   * Get statistics about scan history
   */
  getStatistics(): {
    totalScans: number;
    totalContracts: number;
    totalIssues: number;
    oldestScan?: number;
    newestScan?: number;
    scansByContract: Record<string, number>;
  } {
    const scans = Array.from(this.scans.values());
    const contracts = new Set(scans.map(s => s.contractName));
    const scansByContract: Record<string, number> = {};

    scans.forEach(scan => {
      scansByContract[scan.contractName] = (scansByContract[scan.contractName] || 0) + 1;
    });

    const timestamps = scans.map(s => s.timestamp).sort((a, b) => a - b);

    return {
      totalScans: scans.length,
      totalContracts: contracts.size,
      totalIssues: scans.reduce((sum, scan) => sum + scan.totalIssues, 0),
      oldestScan: timestamps[0],
      newestScan: timestamps[timestamps.length - 1],
      scansByContract,
    };
  }

  /**
   * Apply filters to scan list
   */
  private applyFilters(scans: SorobanScanRecord[], filter: SorobanScanFilter): SorobanScanRecord[] {
    return scans.filter(scan => {
      // Filter by contract name
      if (filter.contractName && scan.contractName !== filter.contractName) {
        return false;
      }

      // Filter by file path pattern
      if (filter.filePathPattern && !filter.filePathPattern.test(scan.filePath)) {
        return false;
      }

      // Filter by network passphrase
      if (filter.networkPassphrase && scan.networkPassphrase !== filter.networkPassphrase) {
        return false;
      }

      // Filter by tags (all tags must be present)
      if (filter.tags && filter.tags.length > 0) {
        const scanTags = scan.tags || [];
        if (!filter.tags.every(tag => scanTags.includes(tag))) {
          return false;
        }
      }

      // Filter by date range
      if (filter.dateRange) {
        if (scan.timestamp < filter.dateRange.start || scan.timestamp > filter.dateRange.end) {
          return false;
        }
      }

      // Filter by minimum severity
      if (filter.minSeverity) {
        const severityOrder = { error: 0, warning: 1, info: 2 };
        const minLevel = severityOrder[filter.minSeverity];
        const hasMatchingSeverity = scan.results.some(
          result => severityOrder[result.severity] <= minLevel
        );
        if (!hasMatchingSeverity) {
          return false;
        }
      }

      // Filter by category
      if (filter.category) {
        const hasMatchingCategory = scan.results.some(
          result => result.category === filter.category
        );
        if (!hasMatchingCategory) {
          return false;
        }
      }

      // Filter by ledger sequence range
      if (filter.ledgerRange) {
        if (filter.ledgerRange.min !== undefined && scan.ledgerSequence! < filter.ledgerRange.min) {
          return false;
        }
        if (filter.ledgerRange.max !== undefined && scan.ledgerSequence! > filter.ledgerRange.max) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Apply sorting to scan list
   */
  private applySorting(scans: SorobanScanRecord[], sort: SorobanScanSortOptions): SorobanScanRecord[] {
    const sorted = [...scans];

    sorted.sort((a, b) => {
      let comparison = 0;

      switch (sort.sortBy) {
        case 'timestamp':
          comparison = a.timestamp - b.timestamp;
          break;
        case 'contractName':
          comparison = a.contractName.localeCompare(b.contractName);
          break;
        case 'totalIssues':
          comparison = a.totalIssues - b.totalIssues;
          break;
        case 'durationMs':
          comparison = a.durationMs - b.durationMs;
          break;
      }

      return sort.sortOrder === 'desc' ? -comparison : comparison;
    });

    return sorted;
  }

  /**
   * Enforce retention policy (max scans per contract, max age)
   */
  private enforceRetentionPolicy(contractName: string): void {
    const contractScans = Array.from(this.scans.values())
      .filter(scan => scan.contractName === contractName)
      .sort((a, b) => b.timestamp - a.timestamp);

    // Remove old scans beyond max count
    if (this.config.maxScansPerContract && contractScans.length > this.config.maxScansPerContract) {
      const toRemove = contractScans.slice(this.config.maxScansPerContract);
      toRemove.forEach(scan => this.scans.delete(scan.scanId));
    }

    // Remove scans beyond max age
    if (this.config.maxScanAgeMs) {
      const cutoffTime = Date.now() - this.config.maxScanAgeMs;
      for (const [scanId, scan] of this.scans.entries()) {
        if (scan.timestamp < cutoffTime) {
          this.scans.delete(scanId);
        }
      }
    }
  }

  /**
   * Ensure storage directory exists
   */
  private ensureStorageDirectory(): void {
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }
  }

  /**
   * Save scan history to disk
   */
  private saveToDisk(): void {
    try {
      const data = JSON.stringify(Array.from(this.scans.entries()), null, 2);
      const filePath = path.join(this.storagePath, 'scan-history.json');
      fs.writeFileSync(filePath, data, 'utf-8');
    } catch (error) {
      console.error('Failed to save scan history to disk:', error);
    }
  }

  /**
   * Load scan history from disk
   */
  private loadFromDisk(): void {
    try {
      const filePath = path.join(this.storagePath, 'scan-history.json');
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf-8');
        const entries = JSON.parse(data);
        this.scans = new Map(entries);
      }
    } catch (error) {
      console.error('Failed to load scan history from disk:', error);
      this.scans = new Map();
    }
  }
}
