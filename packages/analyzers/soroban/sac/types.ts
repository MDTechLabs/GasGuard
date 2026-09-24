/**
 * Issue #920 — Soroban SAC Interaction Analyzer Types
 *
 * Defines the site records, findings, and metrics produced when scanning a
 * Soroban contract for interactions with Stellar Asset Contract (SAC)
 * interfaces — asset operations and repeated calls in particular.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/**
 * Classification of a Stellar Asset Contract interaction.
 *
 * Asset operations move or restrict the asset itself; interface queries
 * (balance/allowance/...) are tracked as interactions but are not asset
 * operations.
 */
export type SacOperationKind =
  | 'transfer'
  | 'transfer_from'
  | 'mint'
  | 'burn'
  | 'burn_from'
  | 'clawback'
  | 'approve'
  | 'revoke_allowance'
  | 'bump_allowance'
  | 'set_authorized'
  | 'set_admin'
  | 'query';

/** The SAC interfaces whose client calls we track. */
export const SAC_CLIENT_METHODS: ReadonlySet<string> = new Set([
  // Asset movement
  'transfer',
  'transfer_from',
  'mint',
  'burn',
  'burn_from',
  'clawback',
  // Allowances / authorizations
  'approve',
  'revoke_allowance',
  'bump_allowance',
  'set_authorized',
  'authorized',
  'allowance',
  // Admin
  'set_admin',
  'admin',
  // Queries
  'balance',
  'spendable_balance',
  'decimals',
  'name',
  'symbol',
]);

/** Methods that mutate the asset itself (supply, balances, restrictions). */
export const ASSET_OPERATION_METHODS: ReadonlySet<string> = new Set([
  'transfer',
  'transfer_from',
  'mint',
  'burn',
  'burn_from',
  'clawback',
  'approve',
  'revoke_allowance',
  'bump_allowance',
  'set_authorized',
  'set_admin',
]);

/** One detected call into a SAC client. */
export interface SacCallSite {
  /** Enclosing function name. */
  fn: string;
  /** Token/asset the call targets (resolved from the client binding). */
  asset: string;
  /** SAC client method invoked. */
  method: string;
  /** Normalized fingerprint of the call arguments. */
  argsFingerprint: string;
  line: number;
  /** Character offset of the call site (source order). */
  offset: number;
  /** Enclosing block stack, used for execution-path comparisons. */
  stack: unknown[];
  /** True when the call happens inside a loop body. */
  inLoop: boolean;
  /** True when the call targets a `try_` variant returning a `Result`. */
  isTryCall: boolean;
  /** Raw call expression text. */
  fullCall: string;
}

/** A detected SAC interaction (any client call site). */
export interface SacInteractionFinding {
  kind: 'interaction';
  severity: Severity;
  line: number;
  fn: string;
  asset: string;
  method: string;
  message: string;
  suggestion: string;
}

/** A detected asset-affecting operation (mint/burn/transfer/clawback/…). */
export interface SacAssetOperationFinding {
  kind: 'asset_operation';
  severity: Severity;
  line: number;
  fn: string;
  asset: string;
  method: string;
  operation: SacOperationCategory;
  message: string;
  suggestion: string;
}

/** A SAC call repeated with identical inputs on the same execution path. */
export interface SacRepeatedCallFinding {
  kind: 'repeated_call';
  severity: Severity;
  line: number;
  firstLine: number;
  fn: string;
  asset: string;
  method: string;
  callCount: number;
  message: string;
  suggestion: string;
}

export type SacOperationCategory =
  | 'transfer'
  | 'supply'
  | 'authorization'
  | 'administration';

export interface SacInteractionMetrics {
  totalSacCalls: number;
  assetOperations: number;
  uniqueAssets: number;
  repeatedCalls: number;
  callsInLoop: number;
}

export interface SacInteractionReport {
  /** Every SAC client call site detected. */
  callSites: SacCallSite[];
  /** Asset-operation sites, one entry per asset-affecting call. */
  assetOperations: SacCallSite[];
  /** Repeated-call sites (2nd..Nth occurrence of an identical call). */
  repeatedCalls: SacCallSite[];
  metrics: SacInteractionMetrics;
}
