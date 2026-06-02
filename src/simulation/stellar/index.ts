/**
 * Stellar Transaction Simulation Module
 *
 * Provides comprehensive transaction simulation capabilities for Stellar/Soroban
 * smart contracts, allowing developers to preview execution behavior and analyze
 * resource consumption before submitting transactions to the network.
 */

export { StellarTransactionSimulator } from "./stellar-simulator";
export { StellarRpcClient } from "./stellar-rpc-client";
export type {
  StellarSimulationRequest,
  StellarSimulationResult,
  ExecutionMetrics,
  SimulationConfig,
  ContractCallSpec,
  SorobanRpcSimulationResponse,
  SorobanSimulationResult,
  SorobanOperationResult,
  SorobanTransactionData,
  SorobanResources,
} from "./types";
