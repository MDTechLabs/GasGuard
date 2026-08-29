/**
 * Stellar RPC Client for Soroban
 *
 * Provides a type-safe interface for communicating with Soroban RPC endpoints,
 * specifically for transaction simulation.
 */

import axios, { AxiosInstance, AxiosError } from "axios";
import { SimulationConfig } from "./types";

/**
 * JSON-RPC 2.0 request structure
 */
interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params: any[];
  id: number;
}

/**
 * JSON-RPC 2.0 response structure
 */
interface JsonRpcResponse<T = any> {
  jsonrpc: "2.0";
  id: number | null;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

/**
 * Soroban RPC Client
 *
 * Handles communication with Soroban RPC endpoints with built-in
 * retry logic, timeout handling, and error management.
 */
export class StellarRpcClient {
  private client: AxiosInstance;
  private config: Required<SimulationConfig>;
  private requestIdCounter: number = 0;

  constructor(rpcUrl: string, config?: SimulationConfig) {
    this.config = {
      timeout: config?.timeout ?? 30000,
      maxRetries: config?.maxRetries ?? 3,
      includeTrace: config?.includeTrace ?? false,
      headers: config?.headers ?? {},
    };

    this.client = axios.create({
      baseURL: rpcUrl,
      timeout: this.config.timeout,
      headers: {
        "Content-Type": "application/json",
        ...this.config.headers,
      },
    });
  }

  /**
   * Simulate a transaction on the Soroban network
   *
   * @param transactionXdr - Transaction envelope XDR to simulate
   * @returns Promise resolving to simulation result
   */
  async simulateTransaction(
    transactionXdr: string,
  ): Promise<Record<string, any>> {
    return this.callRpcMethod("simulateTransaction", [transactionXdr]);
  }

  /**
   * Get the latest ledger information
   *
   * @returns Promise resolving to latest ledger data
   */
  async getLatestLedger(): Promise<Record<string, any>> {
    return this.callRpcMethod("getLatestLedger", []);
  }

  /**
   * Get network configuration
   *
   * @returns Promise resolving to network config
   */
  async getNetwork(): Promise<Record<string, any>> {
    return this.callRpcMethod("getNetwork", []);
  }

  /**
   * Get contract data (storage entries)
   *
   * @param contractId - Contract address
   * @param key - Storage key (XDR encoded)
   * @param durability - Storage durability (instance, persistent, temporary)
   * @returns Promise resolving to contract data
   */
  async getContractData(
    contractId: string,
    key: string,
    durability: string,
  ): Promise<Record<string, any>> {
    return this.callRpcMethod("getContractData", [contractId, key, durability]);
  }

  /**
   * Send a transaction to the network
   *
   * @param transactionXdr - Transaction envelope XDR
   * @returns Promise resolving to send transaction result
   */
  async sendTransaction(transactionXdr: string): Promise<Record<string, any>> {
    return this.callRpcMethod("sendTransaction", [transactionXdr]);
  }

  /**
   * Get transaction status
   *
   * @param hash - Transaction hash
   * @returns Promise resolving to transaction status
   */
  async getTransactionStatus(hash: string): Promise<Record<string, any>> {
    return this.callRpcMethod("getTransactionStatus", [hash]);
  }

  /**
   * Generic RPC method caller with retry logic
   *
   * @param method - RPC method name
   * @param params - Method parameters
   * @param retryCount - Current retry attempt (internal use)
   * @returns Promise resolving to RPC response result
   */
  private async callRpcMethod(
    method: string,
    params: any[],
    retryCount: number = 0,
  ): Promise<any> {
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      method,
      params,
      id: ++this.requestIdCounter,
    };

    try {
      const response = await this.client.post<JsonRpcResponse>("", request);

      // Check for RPC error
      if (response.data.error) {
        throw new Error(
          `RPC Error (${response.data.error.code}): ${response.data.error.message}`,
        );
      }

      // Return result
      return response.data.result;
    } catch (error) {
      // Handle axios errors
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;

        // Retry on network errors or rate limiting
        if (
          !axiosError.response ||
          axiosError.response.status === 429 ||
          axiosError.response.status >= 500
        ) {
          if (retryCount < this.config.maxRetries) {
            // Exponential backoff
            const delay = Math.pow(2, retryCount) * 1000;
            await this.sleep(delay);
            return this.callRpcMethod(method, params, retryCount + 1);
          }
        }

        throw new Error(
          `RPC request failed: ${axiosError.message}${axiosError.response ? ` (Status: ${axiosError.response.status})` : ""}`,
        );
      }

      // Re-throw other errors
      throw error;
    }
  }

  /**
   * Sleep utility for retry backoff
   *
   * @param ms - Milliseconds to sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
