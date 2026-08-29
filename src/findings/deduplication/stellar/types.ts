/**
 * Deduplication Types for Soroban/Stellar Findings
 *
 * Defines the type system for detecting and merging duplicate
 * findings across analysis stages in Soroban contract analysis.
 */

import { Finding, Severity } from '@engine/core';

/**
 * Uniquely identifies a finding for deduplication purposes.
 */
export interface DedupKey {
  ruleId: string;
  normalizedMessage: string;
  startLine: number;
  endLine: number;
  file: string;
}

/**
 * Strategy used to determine if two findings are duplicates.
 */
export enum DedupStrategy {
  EXACT_MATCH = 'exact-match',
  NORMALIZED_MATCH = 'normalized-match',
  FUZZY_MATCH = 'fuzzy-match',
  SAME_LOCATION = 'same-location',
}

/**
 * A group of findings determined to be duplicates of each other.
 */
export interface FindingGroup {
  groupId: string;
  canonical: Finding;
  duplicates: Finding[];
  strategy: DedupStrategy;
  mergeTimestamp: number;
}

/**
 * Configuration for the deduplication engine.
 */
export interface DedupConfig {
  strategies: DedupStrategy[];
  fuzzyThreshold?: number;
  normalizeWhitespace?: boolean;
  ignoreCase?: boolean;
  ignoreLineNumbers?: boolean;
  maxGroupSize?: number;
}

/**
 * Result of the deduplication process.
 */
export interface DedupResult {
  originalCount: number;
  uniqueCount: number;
  duplicateCount: number;
  groups: FindingGroup[];
  mergedFindings: Finding[];
}
