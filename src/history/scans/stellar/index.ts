/**
 * Soroban Scan History Explorer Module
 *
 * Provides functionality to store, retrieve, filter, and explore Soroban contract
 * scan history for tracking analysis results over time.
 */

export { SorobanScanHistoryManager } from './scan-history-manager';
export { SorobanScanHistoryExplorer, ScanExplorerBuilder } from './scan-history-explorer';
export type {
  SorobanScanMetadata,
  SorobanScanRecord,
  SorobanScanFilter,
  SorobanScanSortOptions,
  SorobanScanQueryOptions,
  SorobanScanQueryResult,
  SorobanScanComparison,
  SorobanScanHistoryStorageConfig,
} from './types';
