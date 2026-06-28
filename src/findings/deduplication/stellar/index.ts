/**
 * Soroban Finding Deduplication Engine Module
 *
 * Exports the deduplication engine and related types for detecting
 * and merging duplicate findings in Soroban contract analysis.
 */

export { DeduplicationEngine } from './deduplication-engine';
export { DedupStrategy } from './types';
export type {
  DedupKey,
  FindingGroup,
  DedupConfig,
  DedupResult,
} from './types';
