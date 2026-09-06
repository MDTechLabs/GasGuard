/**
 * Issue #903 — Soroban Contract Entry-Point Analyzer Types
 *
 * Defines types and data structures for analyzing public and externally accessible
 * Soroban contract entry points, extracting function parameters, tracking authorization
 * paths, and inspecting storage access and external calls.
 */

export type FunctionVisibility = 'public' | 'constructor' | 'internal' | 'private';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type RiskLevel = 'critical' | 'high' | 'medium' | 'low' | 'safe';

export type StorageKind = 'instance' | 'persistent' | 'temporary';

export type StorageOperation = 'get' | 'set' | 'has' | 'get_unchecked' | 'extend_ttl' | 'update_ttl';

export type ExternalCallType =
  | 'cross_contract_invoke'
  | 'try_cross_contract_invoke'
  | 'client_call'
  | 'token_transfer'
  | 'token_mint'
  | 'token_burn'
  | 'token_approve'
  | 'balance_query'
  | 'custom_client';

export type AuthCheckType =
  | 'require_auth'
  | 'require_auth_for_args'
  | 'auth_authenticate'
  | 'invoker'
  | 'custom_auth';

export type ContractBlockType =
  | 'contractimpl'
  | 'impl_trait'
  | 'impl_contract'
  | 'pub_trait'
  | 'standalone';

/**
 * Detailed representation of a parsed entry point parameter.
 */
export interface EntryPointParameter {
  /** Parameter identifier */
  name: string;
  /** Rust type signature (e.g., 'Address', 'Vec<Address>', 'i128', 'Env') */
  type: string;
  /** True if this is the Soroban environment parameter `env: Env` or `&Env` */
  isEnv: boolean;
  /** True if this parameter is an `Address` type */
  isAddress: boolean;
  /** True if this parameter is verified via `require_auth()` or `require_auth_for_args()` */
  isAuthParam: boolean;
  /** True if the parameter represents a collection (`Vec`, `Map`, `Bytes`, `BytesN`, `Symbol`, `String`) */
  isCollection: boolean;
  /** True if the parameter is declared mutable (`mut name: Type`) */
  isMutable: boolean;
  /** True if the parameter is a reference (`&Type` or `&mut Type`) */
  isReference: boolean;
  /** True if this parameter is an Option<T> */
  isOptional: boolean;
  /** 1-based line number where parameter is declared */
  line: number;
  /** Optional documentation comment extracted for this parameter */
  docComment?: string;
  /** True if parameter is unreferenced within the function body */
  isUnused?: boolean;
}

/**
 * Represents a single authorization check within an entry point.
 */
export interface AuthCheck {
  /** Type of authorization verification performed */
  type: AuthCheckType;
  /** Name of the target variable/address being authorized (e.g., 'caller', 'admin', 'from') */
  target: string;
  /** Additional arguments passed if `require_auth_for_args` was used */
  args?: string[];
  /** 1-based line number of the authorization check */
  line: number;
  /** Character offset in source */
  offset: number;
  /** True if check resides inside a loop construct */
  isInLoop: boolean;
  /** True if check resides inside a conditional branch */
  isInBranch: boolean;
}

/**
 * Aggregated authorization analysis for an entry point.
 */
export interface AuthorizationSummary {
  /** True if the entry point contains at least one authorization check */
  hasAuthCheck: boolean;
  /** All identified authorization checks */
  checks: AuthCheck[];
  /** List of parameter names explicitly checked by authorization */
  authorizedParams: string[];
  /** Address parameters that were NOT verified by any authorization check */
  unauthorizedAddressParams: string[];
  /** True if an authorization check was found inside a loop (anti-pattern) */
  hasLoopAuth: boolean;
  /** True if both `require_auth` and `require_auth_for_args` are invoked */
  hasRedundantAuth: boolean;
  /** True if state modifications or token transfers occur without any caller authorization */
  isMissingRequiredAuth: boolean;
  /** Authorization coverage ratio (0.0 to 1.0) */
  authCoverage: number;
}

/**
 * Represents an individual storage access site.
 */
export interface StorageAccess {
  /** Storage category: instance, persistent, or temporary */
  storageKind: StorageKind;
  /** Operation: get, set, has, extend_ttl, etc. */
  operation: StorageOperation;
  /** Whether this operation reads or writes state */
  accessType: 'read' | 'write';
  /** Raw key expression passed to the storage operation */
  rawKey: string;
  /** Normalized storage key */
  key: string;
  /** 1-based line number of the access */
  line: number;
  /** Character offset in source */
  offset: number;
  /** True if the storage access is inside a loop */
  isInLoop: boolean;
  /** True if the storage access is inside a conditional branch */
  isInBranch: boolean;
}

/**
 * Aggregated storage access analysis for an entry point.
 */
export interface StorageSummary {
  /** Total count of storage read operations */
  readsCount: number;
  /** Total count of storage write operations */
  writesCount: number;
  /** Total count of TTL extension operations */
  ttlExtensionsCount: number;
  /** Instance storage reads count */
  instanceReads: number;
  /** Instance storage writes count */
  instanceWrites: number;
  /** Persistent storage reads count */
  persistentReads: number;
  /** Persistent storage writes count */
  persistentWrites: number;
  /** Temporary storage reads count */
  temporaryReads: number;
  /** Temporary storage writes count */
  temporaryWrites: number;
  /** Unique storage keys accessed */
  uniqueKeysAccessed: string[];
  /** Unique storage keys written */
  uniqueKeysWritten: string[];
  /** Detailed list of all storage access sites */
  accesses: StorageAccess[];
  /** Storage operations executed inside loops */
  storageInLoopsCount: number;
  /** True if this entry point performs any storage writes */
  isStateMutating: boolean;
}

/**
 * Represents an external or cross-contract call made from an entry point.
 */
export interface ExternalCall {
  /** Type of external call invocation */
  callType: ExternalCallType;
  /** Target contract identifier, variable, or client name */
  target: string;
  /** Method name invoked on the target contract/client */
  method: string;
  /** Arguments passed in invocation */
  args: string[];
  /** 1-based line number where the call is made */
  line: number;
  /** Character offset in source */
  offset: number;
  /** True if this external call is inside a loop */
  isInLoop: boolean;
  /** True if this external call is inside a conditional branch */
  isInBranch: boolean;
}

/**
 * Aggregated external call analysis for an entry point.
 */
export interface ExternalCallSummary {
  /** Total number of external / cross-contract calls */
  totalCalls: number;
  /** Number of raw `env.invoke_contract` invocations */
  crossContractInvocations: number;
  /** Number of typed contract client invocations */
  clientInvocations: number;
  /** Number of token transfer calls (`transfer`, `transfer_from`) */
  tokenTransfers: number;
  /** Number of token balance queries (`balance`, `spendable_balance`) */
  balanceQueries: number;
  /** Number of token mint/burn/clawback operations */
  tokenStateMutations: number;
  /** Number of external calls executed inside loops */
  callsInLoopsCount: number;
  /** Distinct target contracts or clients invoked */
  targetsInvoked: string[];
  /** Detailed list of external call sites */
  calls: ExternalCall[];
}

/**
 * An individual finding or optimization opportunity surfaced for an entry point.
 */
export interface EntryPointFinding {
  /** Unique rule / finding identifier */
  ruleId: string;
  /** Category of finding */
  category: 'authorization' | 'storage' | 'external_calls' | 'parameters' | 'visibility' | 'complexity';
  /** Severity level */
  severity: Severity;
  /** 1-based line number */
  line: number;
  /** Target entry point name */
  entryPointName: string;
  /** Explanatory message */
  message: string;
  /** Concrete actionable recommendation */
  suggestion: string;
}

/**
 * Complete analysis record for a single Soroban entry point.
 */
export interface EntryPoint {
  /** Function name */
  name: string;
  /** Visibility classification */
  visibility: FunctionVisibility;
  /** True if externally accessible / exported */
  isExported: boolean;
  /** Type of enclosing contract block */
  contractBlockType: ContractBlockType;
  /** Name of the contract struct or trait */
  contractName: string;
  /** Name of the trait implemented, if in an `impl Trait for Contract` block */
  traitName?: string;
  /** 1-based line number where function definition begins */
  lineNumber: number;
  /** 1-based line number where function definition ends */
  lineEnd: number;
  /** Total lines in function body */
  bodyLines: number;
  /** Full function signature string */
  signature: string;
  /** Rust doc comment text attached to function, if any */
  docComment?: string;
  /** Extracted parameters */
  parameters: EntryPointParameter[];
  /** Return type string, or null if unit return `()` */
  returnType: string | null;
  /** Authorization analysis */
  authorization: AuthorizationSummary;
  /** Storage access analysis */
  storage: StorageSummary;
  /** External call analysis */
  externalCalls: ExternalCallSummary;
  /** True if function mutates state (storage writes, token transfers, mint/burn) */
  isStateMutating: boolean;
  /** True if function is purely read-only */
  isReadOnly: boolean;
  /** True if function is an initializer/constructor */
  isConstructorOrInit: boolean;
  /** Findings associated with this entry point */
  findings: EntryPointFinding[];
  /** Calculated composite risk score (0–100) */
  riskScore: number;
  /** Qualitative risk level */
  riskLevel: RiskLevel;
}

/**
 * Aggregate summary metrics across all entry points in a contract.
 */
export interface EntryPointAggregateMetrics {
  totalEntryPoints: number;
  publicEntryPointsCount: number;
  constructorCount: number;
  internalFunctionsCount: number;
  stateMutatingCount: number;
  readOnlyCount: number;
  totalAuthChecks: number;
  unprotectedMutatingCount: number;
  totalStorageReads: number;
  totalStorageWrites: number;
  totalExternalCalls: number;
  callsInLoopsCount: number;
  storageInLoopsCount: number;
  authInLoopsCount: number;
}

/**
 * Complete report returned by the Soroban Entry-Point Analyzer.
 */
export interface EntryPointAnalysisReport {
  /** Target contract name */
  contractName: string;
  /** Source file path */
  filePath: string;
  /** All analyzed entry points (including internal if configured) */
  entryPoints: EntryPoint[];
  /** Public and externally accessible entry points */
  publicEntryPoints: EntryPoint[];
  /** Constructor / initializer entry points */
  constructorEntryPoints: EntryPoint[];
  /** Internal / helper functions */
  internalFunctions: EntryPoint[];
  /** All findings across all entry points */
  findings: EntryPointFinding[];
  /** Aggregate metrics */
  metrics: EntryPointAggregateMetrics;
  /** Executive summary description */
  summary: string;
  /** Timestamp when report was generated */
  generatedAt: Date;
}

/**
 * Configuration options for the entry-point analyzer.
 */
export interface EntryPointAnalyzerConfig {
  /** Include internal/private helper functions in analysis (default: true) */
  includeInternal: boolean;
  /** Flag public state-mutating entry points missing caller authorization (default: true) */
  checkMissingAuth: boolean;
  /** Flag external calls inside loops (default: true) */
  checkCallsInLoops: boolean;
  /** Flag storage writes inside loops (default: true) */
  checkStorageInLoops: boolean;
  /** Flag authorization calls inside loops (default: true) */
  checkAuthInLoops: boolean;
  /** Flag unused parameters in public functions (default: true) */
  checkUnusedParams: boolean;
}
