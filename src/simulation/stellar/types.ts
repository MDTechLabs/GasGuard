/**
 * Stellar Transaction Simulation Types
 *
 * Type definitions for simulating Stellar/Soroban contract transactions
 * and extracting execution metrics.
 */

/**
 * Soroban RPC simulation response structure
 */
export interface SorobanRpcSimulationResponse {
  /** Transaction envelope XDR */
  transactionEnvelope?: string;
  /** Simulation result */
  result: SorobanSimulationResult;
  /** Latest ledger sequence */
  latestLedger: number;
  /** Error message if simulation failed */
  error?: string;
}

/**
 * Detailed simulation result from Soroban RPC
 */
export interface SorobanSimulationResult {
  /** Auth entries required */
  auth?: any[];
  /** Transaction events */
  events?: any[];
  /** Execution results */
  results?: SorobanOperationResult[];
  /** Transaction resources consumed */
  transactionData: SorobanTransactionData;
  /** Resource fee in stroops */
  minResourceFee: string;
  /** Whether simulation succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Operation result from simulation
 */
export interface SorobanOperationResult {
  /** Auth entries for this operation */
  auth?: any[];
  /** Execution result */
  returnValue?: string;
  /** Error if operation failed */
  error?: string;
}

/**
 * Transaction resource data from Soroban
 */
export interface SorobanTransactionData {
  /** Resource footprint */
  resources: SorobanResources;
  /** Transaction size in bytes */
  transactionSizeBytes: number;
}

/**
 * Resource consumption details
 */
export interface SorobanResources {
  /** Ledger footprint */
  footprint: {
    /** Read-only ledger entries */
    readOnly: any[];
    /** Read-write ledger entries */
    readWrite: any[];
  };
  /** Instructions consumed */
  instructions: number;
  /** Bytes read */
  readBytes: number;
  /** Bytes written */
  writeBytes: number;
}

/**
 * Stellar transaction simulation request
 */
export interface StellarSimulationRequest {
  /** Contract ID to simulate */
  contractId: string;
  /** Method name to call */
  method: string;
  /** Method parameters (XDR encoded) */
  params: any[];
  /** Source account address */
  sourceAccount?: string;
  /** Network passphrase (e.g., "Test SDF Network ; September 2015") */
  networkPassphrase?: string;
  /** RPC endpoint URL */
  rpcUrl: string;
  /** Whether to include detailed metrics */
  includeMetrics?: boolean;
}

/**
 * Execution metrics from simulation
 */
export interface ExecutionMetrics {
  /** CPU instructions consumed */
  instructions: number;
  /** Peak memory usage in bytes (estimated) */
  memoryBytes: number;
  /** Transaction size in bytes */
  transactionSizeBytes: number;
  /** Number of ledger entries read */
  ledgerReads: number;
  /** Number of ledger entries written */
  ledgerWrites: number;
  /** Total bytes read */
  readBytes: number;
  /** Total bytes written */
  writeBytes: number;
  /** Number of events emitted */
  eventCount: number;
  /** Number of auth entries required */
  authCount: number;
  /** Minimum resource fee in stroops */
  minResourceFee: number;
  /** Simulation execution time (if available) */
  executionTime?: number;
}

/**
 * Stellar transaction simulation result
 */
export interface StellarSimulationResult {
  /** Whether simulation succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Execution metrics */
  metrics: ExecutionMetrics;
  /** Return value (XDR encoded) */
  returnValue?: string;
  /** Events emitted during execution */
  events: any[];
  /** Auth entries required */
  authEntries: any[];
  /** Transaction envelope XDR (if successful) */
  transactionEnvelope?: string;
  /** Latest ledger sequence */
  latestLedger: number;
  /** Simulation timestamp */
  timestamp: number;
}

/**
 * Simulation configuration options
 */
export interface SimulationConfig {
  /** RPC request timeout in milliseconds */
  timeout?: number;
  /** Maximum retry attempts */
  maxRetries?: number;
  /** Whether to include detailed execution traces */
  includeTrace?: boolean;
  /** Custom headers for RPC requests */
  headers?: Record<string, string>;
}

/**
 * Contract call specification
 */
export interface ContractCallSpec {
  /** Contract ID */
  contractId: string;
  /** Method name */
  method: string;
  /** Method parameters */
  params: any[];
}
