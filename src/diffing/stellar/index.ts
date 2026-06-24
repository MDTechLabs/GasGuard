/**
 * Soroban Analysis Result Diffing Module
 * 
 * Provides functionality to compare Soroban contract analysis results between scans,
 * highlighting added and removed issues with detailed breakdowns.
 */

export { SorobanResultDiffer } from './soroban-result-differ';
export { SorobanDiffReporter } from './soroban-diff-reporter';
export type {
  SorobanAnalysisResult,
  SorobanScanDiff,
  SorobanDiffReportOptions
} from './types';
