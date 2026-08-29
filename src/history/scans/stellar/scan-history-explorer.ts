/**
 * Soroban Scan History Explorer
 *
 * Provides high-level exploration and analysis functionality for Soroban scan history.
 * Builds on the ScanHistoryManager to provide convenient methods for browsing and analyzing scans.
 */

import {
  SorobanScanRecord,
  SorobanScanMetadata,
  SorobanScanFilter,
  SorobanScanQueryOptions,
  SorobanScanQueryResult,
  SorobanScanComparison,
} from './types';
import { SorobanScanHistoryManager } from './scan-history-manager';

export class SorobanScanHistoryExplorer {
  private manager: SorobanScanHistoryManager;

  constructor(manager?: SorobanScanHistoryManager) {
    this.manager = manager || new SorobanScanHistoryManager();
  }

  /**
   * Get the underlying history manager
   */
  getManager(): SorobanScanHistoryManager {
    return this.manager;
  }

  /**
   * Explore scan history with a fluent interface
   */
  explore(): ScanExplorerBuilder {
    return new ScanExplorerBuilder(this.manager);
  }

  /**
   * Get a summary of all contracts with scan history
   */
  getContractSummary(): Array<{
    contractName: string;
    scanCount: number;
    latestScan?: SorobanScanMetadata;
    totalIssues: number;
    averageIssuesPerScan: number;
  }> {
    const stats = this.manager.getStatistics();
    const summary: Array<{
      contractName: string;
      scanCount: number;
      latestScan?: SorobanScanMetadata;
      totalIssues: number;
      averageIssuesPerScan: number;
    }> = [];

    for (const [contractName, scanCount] of Object.entries(stats.scansByContract)) {
      const scans = this.manager.getScansByContract(contractName, false);
      const latestScan = scans.length > 0 ? this.manager.getScanMetadata(scans[0].scanId) : undefined;
      const totalIssues = scans.reduce((sum, scan) => sum + scan.totalIssues, 0);
      const averageIssuesPerScan = scanCount > 0 ? totalIssues / scanCount : 0;

      summary.push({
        contractName,
        scanCount,
        latestScan,
        totalIssues,
        averageIssuesPerScan,
      });
    }

    // Sort by scan count descending
    summary.sort((a, b) => b.scanCount - a.scanCount);

    return summary;
  }

  /**
   * Get trend analysis for a contract over time
   */
  getTrendAnalysis(
    contractName: string,
    options?: {
      maxScans?: number;
    }
  ): Array<{
    scanId: string;
    timestamp: number;
    totalIssues: number;
    errorCount: number;
    warningCount: number;
    infoCount: number;
    durationMs: number;
  }> {
    const maxScans = options?.maxScans || 20;
    const scans = this.manager.getScansByContract(contractName, false).slice(0, maxScans);

    return scans.map(scan => ({
      scanId: scan.scanId,
      timestamp: scan.timestamp,
      totalIssues: scan.totalIssues,
      errorCount: scan.severityBreakdown.error,
      warningCount: scan.severityBreakdown.warning,
      infoCount: scan.severityBreakdown.info,
      durationMs: scan.durationMs,
    }));
  }

  /**
   * Find scans with specific characteristics
   */
  findScansWithIssues(options: {
    minSeverity?: 'error' | 'warning' | 'info';
    category?: string;
    contractName?: string;
  }): SorobanScanRecord[] {
    const filter: SorobanScanFilter = {};
    if (options.contractName) filter.contractName = options.contractName;
    if (options.minSeverity) filter.minSeverity = options.minSeverity;
    if (options.category) filter.category = options.category;

    return this.manager.queryScans({
      filter,
      includeResults: true,
      sort: { sortBy: 'timestamp', sortOrder: 'desc' },
    }).scans;
  }

  /**
   * Get recent scans across all contracts
   */
  getRecentScans(limit = 10): SorobanScanMetadata[] {
    const result = this.manager.queryScans({
      limit,
      includeResults: false,
      sort: { sortBy: 'timestamp', sortOrder: 'desc' },
    });

    return result.scans.map(scan => {
      const { results, ...metadata } = scan;
      return metadata;
    });
  }

  /**
   * Get scans by tag
   */
  getScansByTag(tag: string): SorobanScanRecord[] {
    return this.manager.queryScans({
      filter: { tags: [tag] },
      includeResults: true,
      sort: { sortBy: 'timestamp', sortOrder: 'desc' },
    }).scans;
  }

  /**
   * Get comparison history for a contract (all consecutive comparisons)
   */
  getComparisonHistory(contractName: string): SorobanScanComparison[] {
    const scans = this.manager.getScansByContract(contractName, true);
    const comparisons: SorobanScanComparison[] = [];

    for (let i = 0; i < scans.length - 1; i++) {
      const comparison = this.manager.compareScans(scans[i + 1].scanId, scans[i].scanId);
      if (comparison) {
        comparisons.push(comparison);
      }
    }

    return comparisons;
  }

  /**
   * Search scans by description or notes
   */
  searchByDescription(query: string): SorobanScanRecord[] {
    const allScans = Array.from(
      this.manager.queryScans({ includeResults: true }).scans
    );

    const lowerQuery = query.toLowerCase();
    return allScans.filter(
      scan =>
        scan.description?.toLowerCase().includes(lowerQuery) ||
        scan.tags?.some(tag => tag.toLowerCase().includes(lowerQuery))
    );
  }
}

/**
 * Fluent builder for exploring scan history
 */
export class ScanExplorerBuilder {
  private filter: SorobanScanFilter = {};
  private sort?: { sortBy: 'timestamp' | 'contractName' | 'totalIssues' | 'durationMs'; sortOrder: 'asc' | 'desc' };
  private limit?: number;
  private offset?: number;
  private includeResults = false;

  constructor(private manager: SorobanScanHistoryManager) {}

  /**
   * Filter by contract name
   */
  byContract(contractName: string): this {
    this.filter.contractName = contractName;
    return this;
  }

  /**
   * Filter by file path pattern
   */
  byFilePath(pattern: RegExp): this {
    this.filter.filePathPattern = pattern;
    return this;
  }

  /**
   * Filter by network
   */
  byNetwork(networkPassphrase: string): this {
    this.filter.networkPassphrase = networkPassphrase;
    return this;
  }

  /**
   * Filter by tags
   */
  byTags(...tags: string[]): this {
    this.filter.tags = tags;
    return this;
  }

  /**
   * Filter by date range
   */
  byDateRange(start: number, end: number): this {
    this.filter.dateRange = { start, end };
    return this;
  }

  /**
   * Filter by minimum severity
   */
  byMinSeverity(severity: 'error' | 'warning' | 'info'): this {
    this.filter.minSeverity = severity;
    return this;
  }

  /**
   * Filter by category
   */
  byCategory(category: string): this {
    this.filter.category = category;
    return this;
  }

  /**
   * Filter by ledger sequence range
   */
  byLedgerRange(min?: number, max?: number): this {
    this.filter.ledgerRange = { min, max };
    return this;
  }

  /**
   * Sort results
   */
  sortBy(
    sortBy: 'timestamp' | 'contractName' | 'totalIssues' | 'durationMs',
    sortOrder: 'asc' | 'desc' = 'desc'
  ): this {
    this.sort = { sortBy, sortOrder };
    return this;
  }

  /**
   * Limit number of results
   */
  limitResults(limit: number): this {
    this.limit = limit;
    return this;
  }

  /**
   * Set offset for pagination
   */
  skip(offset: number): this {
    this.offset = offset;
    return this;
  }

  /**
   * Include full results in output
   */
  withResults(): this {
    this.includeResults = true;
    return this;
  }

  /**
   * Execute the query and return results
   */
  execute(): SorobanScanQueryResult {
    return this.manager.queryScans({
      filter: Object.keys(this.filter).length > 0 ? this.filter : undefined,
      sort: this.sort,
      limit: this.limit,
      offset: this.offset,
      includeResults: this.includeResults,
    });
  }

  /**
   * Execute the query and return only the scan array
   */
  toArray(): SorobanScanRecord[] {
    return this.execute().scans;
  }

  /**
   * Execute the query and return only metadata
   */
  toMetadataArray(): SorobanScanMetadata[] {
    return this.toArray().map(scan => {
      const { results, ...metadata } = scan;
      return metadata;
    });
  }
}
