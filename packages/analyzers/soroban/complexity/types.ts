/**
 * Issue #904 — Soroban Overloaded Entry-Point Analyzer Types
 *
 * Defines types and data structures for measuring entry-point complexity,
 * tracking storage operations and external calls, configuring threshold limits,
 * and identifying overloaded entry points handling excessive responsibilities.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type OverloadDimension =
  | 'control_flow'
  | 'storage_operations'
  | 'external_calls'
  | 'code_size'
  | 'parameter_count';

/**
 * Control flow and structural complexity metrics for an entry point.
 */
export interface ComplexityMetrics {
  /** McCabe Cyclomatic Complexity score (decision points + 1) */
  cyclomaticComplexity: number;
  /** Cognitive Complexity score (including nesting penalties) */
  cognitiveComplexity: number;
  /** Total Lines of Code (excluding blank lines/comments) */
  linesOfCode: number;
  /** Estimated statement count */
  statementsCount: number;
  /** Count of branching decision points (`if`, `else if`, `match` arms, `?`, logical ops) */
  decisionPointsCount: number;
  /** Count of conditional branches */
  branchCount: number;
  /** Count of loop structures (`for`, `while`, `loop`) */
  loopCount: number;
  /** Maximum block nesting depth */
  nestingDepthMax: number;
  /** Number of parameters accepted */
  parameterCount: number;
}

/**
 * Storage resource metrics tracked for an entry point.
 */
export interface StorageResourceMetrics {
  /** Total count of all storage operations (reads + writes + TTLs) */
  totalStorageOperations: number;
  /** Storage read operations count (`get`, `has`, `get_unchecked`) */
  readsCount: number;
  /** Storage write operations count (`set`, `put`) */
  writesCount: number;
  /** Storage TTL extension operations count */
  ttlExtensionsCount: number;
  /** Instance storage operations count */
  instanceOps: number;
  /** Persistent storage operations count */
  persistentOps: number;
  /** Temporary storage operations count */
  temporaryOps: number;
  /** Count of unique storage keys accessed */
  uniqueKeysCount: number;
  /** Distinct keys accessed */
  uniqueKeys: string[];
  /** Storage operations executed inside loops */
  storageInLoopsCount: number;
}

/**
 * External and cross-contract call resource metrics tracked for an entry point.
 */
export interface ExternalCallResourceMetrics {
  /** Total count of external invocations */
  totalCalls: number;
  /** Number of raw `env.invoke_contract` / `try_invoke_contract` calls */
  crossContractInvocations: number;
  /** Number of typed contract client invocations */
  clientInvocations: number;
  /** Number of token transfer calls (`transfer`, `transfer_from`) */
  tokenTransfers: number;
  /** Number of token state mutating calls (`mint`, `burn`, `approve`, `clawback`) */
  tokenStateMutations: number;
  /** Number of balance queries (`balance`, `spendable_balance`) */
  balanceQueries: number;
  /** External calls executed inside loops */
  callsInLoopsCount: number;
  /** Count of distinct external target contracts/clients invoked */
  distinctTargetsCount: number;
  /** Unique external targets identified */
  targets: string[];
}

/**
 * Configurable thresholds for identifying overloaded entry points.
 */
export interface ComplexityThresholds {
  /** Maximum acceptable cyclomatic complexity (default: 10) */
  maxCyclomaticComplexity: number;
  /** Maximum acceptable cognitive complexity (default: 15) */
  maxCognitiveComplexity: number;
  /** Maximum lines of code in function body (default: 50) */
  maxLinesOfCode: number;
  /** Maximum total storage operations in an entry point (default: 5) */
  maxStorageOperations: number;
  /** Maximum storage writes in an entry point (default: 3) */
  maxStorageWrites: number;
  /** Maximum external/cross-contract calls in an entry point (default: 3) */
  maxExternalCalls: number;
  /** Maximum parameters accepted by an entry point (default: 6) */
  maxParameters: number;
  /** Composite overload score threshold (0–100, default: 65) */
  maxOverloadScore: number;
}

/**
 * Finding generated when an entry point exceeds complexity or resource thresholds.
 */
export interface OverloadFinding {
  /** Unique finding/rule identifier */
  ruleId: string;
  /** Name of the affected entry point */
  entryPointName: string;
  /** Dimension of the overload */
  dimension: OverloadDimension;
  /** Severity rating */
  severity: Severity;
  /** 1-based line number */
  line: number;
  /** Actual measured value */
  metricValue: number;
  /** Configured threshold that was exceeded */
  threshold: number;
  /** Description of the issue */
  message: string;
  /** Concrete suggestion for refactoring */
  suggestion: string;
}

/**
 * Detailed complexity and resource evaluation for a single entry point.
 */
export interface EntryPointComplexity {
  /** Function name */
  name: string;
  /** Visibility classification */
  visibility: string;
  /** True if public or externally accessible */
  isExported: boolean;
  /** 1-based line number of function start */
  line: number;
  /** 1-based line number of function end */
  lineEnd: number;
  /** Control flow and structural complexity metrics */
  metrics: ComplexityMetrics;
  /** Storage resource operations */
  storage: StorageResourceMetrics;
  /** External / cross-contract operations */
  externalCalls: ExternalCallResourceMetrics;
  /** Composite overload score (0–100) */
  overloadScore: number;
  /** True if any threshold or the composite score was exceeded */
  isOverloaded: boolean;
  /** Human-readable reasons for being classified as overloaded */
  overloadReasons: string[];
  /** Findings associated with this entry point */
  findings: OverloadFinding[];
  /** Recommendations for refactoring */
  recommendations: string[];
}

/**
 * Aggregate metrics across all analyzed entry points in a contract.
 */
export interface ContractComplexityMetrics {
  totalEntryPoints: number;
  overloadedCount: number;
  averageCyclomaticComplexity: number;
  averageCognitiveComplexity: number;
  averageLinesOfCode: number;
  totalStorageOperations: number;
  totalStorageWrites: number;
  totalExternalCalls: number;
  maxOverloadScore: number;
  mostComplexEntryPoint?: EntryPointComplexity;
}

/**
 * Complete complexity analysis report for a Soroban contract.
 */
export interface ComplexityReport {
  /** Target contract name */
  contractName: string;
  /** Source file path */
  filePath: string;
  /** All analyzed entry points */
  entryPoints: EntryPointComplexity[];
  /** Entry points classified as overloaded */
  overloadedEntryPoints: EntryPointComplexity[];
  /** Total count of entry points analyzed */
  totalEntryPoints: number;
  /** Count of overloaded entry points */
  overloadedCount: number;
  /** All generated findings */
  findings: OverloadFinding[];
  /** Contract-wide aggregate complexity metrics */
  aggregateMetrics: ContractComplexityMetrics;
  /** Configured thresholds applied during analysis */
  thresholds: ComplexityThresholds;
  /** Executive summary */
  summary: string;
  /** Timestamp when report was generated */
  generatedAt: Date;
}
