/**
 * Soroban TTL analyzer types (issue #885).
 *
 * These types describe the storage/TTL operations found in a contract and the
 * actionable findings produced from them. They are intentionally free of any
 * framework dependency so the analyzer can be reused by the rule layer.
 */

/** Storage tier an operation targets. */
export type TtlStorageTier = 'persistent' | 'instance' | 'temporary';

/** Kind of storage operation the analyzer recognizes. */
export type TtlOperationKind = 'write' | 'extend_ttl';

/** A single `set(...)` or `extend_ttl(...)` call site. */
export interface TtlOperation {
  kind: TtlOperationKind;
  /** Normalized storage key expression (e.g. `DataKey::Config`). */
  key: string;
  tier: TtlStorageTier;
  /** 1-based line of the call site. */
  line: number;
  functionName: string;
  /** Raw threshold argument of an `extend_ttl` call. */
  thresholdArg?: string;
  /** Raw `extend_to` argument of an `extend_ttl` call. */
  extendToArg?: string;
  /** True when the call sits inside a loop body. */
  inLoop: boolean;
}

/** Classification of a produced finding. */
export type TtlFindingKind =
  | 'missing_extension'
  | 'excessive_extension'
  | 'short_extend_ttl'
  | 'invalid_extension_range';

/** An actionable TTL finding. */
export interface TtlFinding {
  ruleId: string;
  kind: TtlFindingKind;
  severity: 'high' | 'medium' | 'low';
  /** 1-based line of the offending call site. */
  line: number;
  key?: string;
  functionName?: string;
  message: string;
  /** Concrete remediation the developer can apply. */
  recommendation: string;
}

/** Aggregate counters for a single analysis run. */
export interface TtlAnalysisMetrics {
  totalOperations: number;
  writes: number;
  extensions: number;
  persistentEntries: number;
  extendedEntries: number;
  unextendedEntries: number;
  shortTtlValues: number;
  invalidRanges: number;
  extensionsInLoops: number;
}

/** Full analyzer output. */
export interface SorobanTtlAnalysisResult {
  operations: TtlOperation[];
  findings: TtlFinding[];
  metrics: TtlAnalysisMetrics;
  summary: string;
}

/** Tuning for "unusually short" TTL detection. */
export interface ShortTtlOptions {
  /** Ledgers below which an `extend_to` value is flagged (default 30 days). */
  recommendedMinLedgers?: number;
  /** Ledgers below which an `extend_to` value is critical (default 1 day). */
  absoluteMinLedgers?: number;
}
