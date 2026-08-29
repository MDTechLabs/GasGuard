/**
 * Issue #905 — Soroban Entry-Point Resource Profiler Types
 *
 * Defines data structures for aggregating CPU, memory, storage,
 * and contract-call resource impacts per Soroban smart contract entry point,
 * and ranking entry points by composite estimated cost.
 */

export type ResourceCategory = 'cpu' | 'memory' | 'storage' | 'contract-calls';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type CostTier = 'critical' | 'high' | 'medium' | 'low';

export type FunctionVisibility = 'public' | 'constructor' | 'internal' | 'private';

export interface ResourceFinding {
  ruleId: string;
  category: ResourceCategory;
  severity: Severity;
  line: number;
  message: string;
  suggestion: string;
  weight: number;
}

export interface CpuImpact {
  /** Relative CPU score (0–100) */
  score: number;
  /** Count of loops without explicit bound */
  unboundedLoops: number;
  /** Count of nested loop structures */
  nestedLoops: number;
  /** Count of Map / Vec collection iterations */
  collectionIterations: number;
  /** Count of cryptographic primitive invocations (sha256, keccak256, ed25519, etc.) */
  cryptoOperations: number;
  /** Count of serialization / deserialization operations */
  serializationOps: number;
  /** Count of dynamic string formatting operations */
  dynamicFormatting: number;
  /** Count of storage accesses inside loops */
  storageInLoops: number;
  /** List of detected heavy CPU operation tags */
  heavyOperations: string[];
  /** Detailed human-readable notes */
  details: string[];
}

export interface MemoryImpact {
  /** Relative memory score (0–100) */
  score: number;
  /** Count of large pre-allocated vectors/maps */
  largeAllocations: number;
  /** Count of nested collections (Vec<Vec<_>>, Map<_, Vec<_>>) */
  nestedCollections: number;
  /** Count of `.clone()` calls inside loops */
  cloneInLoops: number;
  /** Count of heap `Box::new` allocations */
  boxAllocations: number;
  /** Count of `.collect()` materializations */
  collectIterator: number;
  /** Count of large struct definitions */
  largeStructStack: number;
  /** Detailed human-readable notes */
  details: string[];
}

export interface StorageImpact {
  /** Relative storage score (0–100) */
  score: number;
  /** Total storage reads (get, has) */
  readsCount: number;
  /** Total storage writes (set, update, remove) */
  writesCount: number;
  /** Persistent storage reads */
  persistentReads: number;
  /** Persistent storage writes */
  persistentWrites: number;
  /** Instance storage reads */
  instanceReads: number;
  /** Instance storage writes */
  instanceWrites: number;
  /** Temporary storage reads */
  temporaryReads: number;
  /** Temporary storage writes */
  temporaryWrites: number;
  /** Storage operations executed inside loop bodies */
  storageInLoops: number;
  /** TTL extension calls (extend_ttl) */
  ttlExtensions: number;
  /** Detailed human-readable notes */
  details: string[];
}

export interface ContractCallImpact {
  /** Relative contract-call score (0–100) */
  score: number;
  /** Count of cross-contract invocations (env.invoke_contract, Client::new) */
  crossContractInvocations: number;
  /** Count of token transfers (transfer, transfer_from) */
  tokenTransfers: number;
  /** Count of balance queries (balance, balance_of) */
  balanceQueries: number;
  /** Count of authorization checks (require_auth, etc.) */
  authChecks: number;
  /** Resolved external call target identifiers/tokens */
  externalCallTargets: string[];
  /** Detailed human-readable notes */
  details: string[];
}

export interface EntryPointFinding {
  ruleId: string;
  category: ResourceCategory;
  severity: Severity;
  line: number;
  message: string;
  suggestion: string;
}

export interface EntryPointProfile {
  /** Function / entry-point name */
  name: string;
  /** Name of the contract enclosing this entry point */
  contractName: string;
  /** Visibility classification */
  visibility: FunctionVisibility;
  /** True if public entry point callable externally */
  isExported: boolean;
  /** Source code definition line number */
  lineNumber: number;
  /** Approximate body line count */
  bodyLines: number;
  /** Normalized parameter signatures */
  params: string[];
  /** Return type expression if any */
  returnType: string | null;
  /** Aggregated CPU impact */
  cpu: CpuImpact;
  /** Aggregated Memory impact */
  memory: MemoryImpact;
  /** Aggregated Storage impact */
  storage: StorageImpact;
  /** Aggregated Contract-Call impact */
  contractCalls: ContractCallImpact;
  /** Composite estimated cost score (0–100) */
  totalEstimatedCost: number;
  /** Cost severity tier */
  costTier: CostTier;
  /** 1-based rank among entry points (1 = most expensive) */
  rank: number;
  /** Identified resource hotspot descriptions */
  hotspots: string[];
  /** Specific findings detected in this entry point */
  findings: EntryPointFinding[];
  /** Optimization recommendations */
  recommendations: string[];
}

export interface AggregateResourceMetrics {
  /** Sum of estimated cost across entry points */
  totalEstimatedCost: number;
  /** Mean estimated cost across entry points */
  averageCost: number;
  /** Mean CPU score across entry points */
  totalCpuScore: number;
  /** Mean Memory score across entry points */
  totalMemoryScore: number;
  /** Aggregate storage reads */
  totalStorageReads: number;
  /** Aggregate storage writes */
  totalStorageWrites: number;
  /** Aggregate cross-contract and token calls */
  totalContractCalls: number;
}

export interface CostWeights {
  cpu: number;
  memory: number;
  storage: number;
  contractCalls: number;
}

export interface CostThresholds {
  critical: number;
  high: number;
  medium: number;
}

export interface ProfilerConfig {
  /** Custom category weighting (must sum to 1.0) */
  weights: CostWeights;
  /** Cost tier score thresholds */
  thresholds: CostThresholds;
  /** Only profile public entry points (default: true) */
  onlyPublic: boolean;
  /** Include private/internal helper functions (default: false) */
  includeInternal: boolean;
}

export interface EntryPointProfileReport {
  /** Target contract name */
  contractName: string;
  /** Source file path */
  filePath: string;
  /** All profiled entry points */
  entryPoints: EntryPointProfile[];
  /** Entry points ranked from highest to lowest cost */
  rankedEntryPoints: EntryPointProfile[];
  /** Total count of functions analyzed */
  totalEntryPoints: number;
  /** Count of public entry points */
  publicEntryPointsCount: number;
  /** Entry point with highest estimated cost */
  mostExpensiveEntryPoint?: EntryPointProfile;
  /** Entry point with lowest estimated cost */
  leastExpensiveEntryPoint?: EntryPointProfile;
  /** Aggregate resource metrics across all entry points */
  aggregateMetrics: AggregateResourceMetrics;
  /** Applied cost score thresholds */
  costThresholds: CostThresholds;
  /** Executive summary description */
  summary: string;
  /** Timestamp when the profile was generated */
  generatedAt: Date;
}
