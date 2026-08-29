/**
 * Soroban Contract Call Trace Analyzer Module
 * 
 * Exports the main trace analyzer components for Soroban contract execution traces
 */

export { SorobanTraceAnalyzer, analyzeSorobanTrace } from './trace-analyzer';
export type { 
  TraceEvent, 
  TraceAnalysis, 
  CallTreeNode, 
  StorageOperation, 
  EventEmission, 
  PerformanceMetrics 
} from './trace-analyzer';
