/**
 * Stellar Fee Estimation Engine Types
 *
 * Type definitions for estimating Stellar smart contract execution fees
 * based on simulation results and network configuration.
 */

/**
 * Soroban network configuration for fee calculations
 */
export interface StellarNetworkConfig {
  /** Chain identifier (e.g., "soroban-mainnet", "soroban-testnet") */
  chainId: string;
  /** Network name */
  chainName: string;
  /** RPC endpoint URL */
  rpcUrl?: string;

  // CPU/Compute configuration
  /** Maximum instructions per transaction */
  txMaxInstructions: number;
  /** Maximum instructions per ledger */
  ledgerMaxInstructions: number;
  /** Fee rate per instruction increment */
  feeRatePerInstructionsIncrement: number;
  /** Fee per CPU instruction increment (in stroops) */
  feeCPUPerIncrement: number;
  /** Transaction memory limit in bytes */
  txMemoryLimit: number;

  // Ledger I/O configuration
  /** Max read ledger entries per transaction */
  txMaxReadLedgerEntries: number;
  /** Max read bytes per transaction */
  txMaxReadBytes: number;
  /** Max write ledger entries per transaction */
  txMaxWriteLedgerEntries: number;
  /** Max write bytes per transaction */
  txMaxWriteBytes: number;

  // Ledger I/O fees (in stroops)
  /** Fee per read ledger entry */
  feeReadLedgerEntry: number;
  /** Fee per write ledger entry */
  feeWriteLedgerEntry: number;
  /** Fee per 1KB read */
  feeRead1KB: number;
  /** Fee per 1KB write */
  feeWrite1KB: number;

  // Bandwidth configuration
  /** Max transaction size in bytes */
  txMaxSizeBytes: number;
  /** Fee per 1KB transaction size */
  feeTxSize1KB: number;

  /** Network version identifier */
  version?: string;
}

/**
 * Ledger entry footprint for a transaction
 */
export interface LedgerFootprint {
  /** Read-only ledger entry keys */
  readOnly: string[];
  /** Read-write ledger entry keys */
  readWrite: string[];
}

/**
 * Transaction resources from simulation
 */
export interface TransactionResources {
  /** Ledger entry footprint */
  footprint: LedgerFootprint;
  /** Number of instructions consumed */
  instructions: number;
  /** Total bytes read */
  readBytes: number;
  /** Total bytes written */
  writeBytes: number;
}

/**
 * Result from Soroban RPC simulateTransaction call
 */
export interface SimulationResult {
  /** CPU instructions consumed */
  instructions: number;
  /** Peak memory usage in bytes */
  memoryBytes: number;
  /** Transaction resources */
  resources: TransactionResources;
  /** Transaction size in bytes */
  transactionSizeBytes: number;
  /** Whether the simulation reverted */
  reverted?: boolean;
  /** Error message if simulation failed */
  error?: string;
}

/**
 * CPU cost breakdown
 */
export interface CPUCost {
  /** Base fee in stroops */
  fee: number;
  /** Normalized utilization [0, 1] */
  normalized: number;
  /** Ledger pressure factor [0, 1] */
  ledgerPressure: number;
  /** Total cost with pressure adjustment in stroops */
  total: number;
}

/**
 * Memory cost breakdown
 */
export interface MemoryCost {
  /** Bytes used */
  bytesUsed: number;
  /** Normalized utilization [0, 1] */
  normalized: number;
  /** Penalty score (no direct fees in Soroban) */
  costScore: number;
}

/**
 * Ledger I/O and bandwidth cost breakdown
 */
export interface LedgerCost {
  /** Total fee in stroops */
  fee: number;
  /** Normalized utilization [0, 1] */
  normalized: number;
  /** Utilization breakdown by dimension */
  breakdown: {
    readEntries: number;
    readBytes: number;
    writeEntries: number;
    writeBytes: number;
    bandwidth: number;
  };
}

/**
 * Complete fee estimation result
 */
export interface FeeEstimationResult {
  /** Chain ID */
  chainId: string;
  /** Timestamp of estimation */
  timestamp: number;

  // Cost breakdowns
  /** CPU cost details */
  cpuCost: CPUCost;
  /** Memory cost details */
  memoryCost: MemoryCost;
  /** Ledger I/O cost details */
  ledgerCost: LedgerCost;

  // Total fees
  /** Total resource fee in stroops */
  totalFeeStroops: number;
  /** Total resource fee in XLM */
  totalFeeXLM: number;

  // Efficiency scores
  /** Resource efficiency scores */
  scores: EfficiencyScores;

  // Optimization hints
  /** Actionable optimization suggestions */
  optimizationHints: string[];
  /** Safety violations if any */
  safetyViolations: string[];

  // Confidence metrics
  /** Estimation confidence percentage [0, 100] */
  confidence: number;
}

/**
 * Resource efficiency scores (0-100 scale)
 */
export interface EfficiencyScores {
  /** CPU efficiency score */
  cpu: number;
  /** Memory efficiency score */
  memory: number;
  /** Ledger efficiency score */
  ledger: number;
  /** Overall weighted score */
  total: number;
}

/**
 * Priority level for fee estimation
 */
export type FeePriority = "low" | "normal" | "high" | "critical";

/**
 * Fee estimation options
 */
export interface FeeEstimationOptions {
  /** Priority level (affects safety margins) */
  priority?: FeePriority;
  /** Additional safety margin multiplier (default: 1.15) */
  safetyMargin?: number;
  /** Include optimization hints */
  includeHints?: boolean;
  /** Include safety checks */
  includeSafetyChecks?: boolean;
}

/**
 * Simulation-based fee estimation request
 */
export interface SimulationFeeRequest {
  /** Contract ID (for context) */
  contractId?: string;
  /** Method name to simulate */
  method: string;
  /** Method parameters */
  params: any[];
  /** Contract WASM or code */
  contractCode?: string;
  /** Network configuration */
  networkConfig: StellarNetworkConfig;
  /** Estimation options */
  options?: FeeEstimationOptions;
}

/**
 * Direct fee estimation from simulation results
 */
export interface DirectFeeRequest {
  /** Simulation results */
  simulation: SimulationResult;
  /** Network configuration */
  networkConfig: StellarNetworkConfig;
  /** Estimation options */
  options?: FeeEstimationOptions;
}
