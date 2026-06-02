/**
 * Stellar Transaction Simulator Tests
 */

import { StellarTransactionSimulator } from "../stellar-simulator";
import { StellarRpcClient } from "../stellar-rpc-client";
import { StellarSimulationRequest, StellarSimulationResult } from "../types";

// Mock the StellarRpcClient
jest.mock("../stellar-rpc-client");

describe("StellarTransactionSimulator", () => {
  let simulator: StellarTransactionSimulator;
  const testRpcUrl = "https://soroban-testnet.stellar.org";
  const testContractId =
    "CDLZVWRQK6QZL4QF5VQKQZL4QF5VQKQZL4QF5VQKQZL4QF5VQKQZL4QF";

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();
    simulator = new StellarTransactionSimulator(testRpcUrl);
  });

  describe("constructor", () => {
    it("should create an instance with default config", () => {
      expect(simulator).toBeDefined();
    });

    it("should create an instance with custom config", () => {
      const customSimulator = new StellarTransactionSimulator(testRpcUrl, {
        timeout: 5000,
        maxRetries: 5,
      });
      expect(customSimulator).toBeDefined();
    });
  });

  describe("simulateContractCall", () => {
    const mockRequest: StellarSimulationRequest = {
      contractId: testContractId,
      method: "transfer",
      params: ["alice", "bob", 1000],
      rpcUrl: testRpcUrl,
    };

    it("should successfully simulate a contract call", async () => {
      const mockRpcResponse = {
        result: {
          success: true,
          auth: [],
          events: [
            {
              contract_id: testContractId,
              type: "system",
              topics: ["transfer"],
              value: { amount: 1000 },
            },
          ],
          results: [
            {
              auth: [],
              returnValue: "success",
            },
          ],
          transactionData: {
            resources: {
              footprint: {
                readOnly: ["ContractData(balance_alice)"],
                readWrite: ["ContractData(balance_bob)"],
              },
              instructions: 1_250_000,
              readBytes: 512,
              writeBytes: 256,
            },
            transactionSizeBytes: 4096,
          },
          minResourceFee: "150000",
        },
        latestLedger: 123456,
        transactionEnvelope: "AAAAAA==",
      };

      (StellarRpcClient as jest.Mock).mockImplementation(() => ({
        simulateTransaction: jest.fn().mockResolvedValue(mockRpcResponse),
      }));

      const result = await simulator.simulateContractCall(mockRequest);

      expect(result.success).toBe(true);
      expect(result.metrics.instructions).toBe(1_250_000);
      expect(result.metrics.ledgerReads).toBe(1);
      expect(result.metrics.ledgerWrites).toBe(1);
      expect(result.metrics.eventCount).toBe(1);
      expect(result.metrics.authCount).toBe(0);
      expect(result.events.length).toBe(1);
      expect(result.latestLedger).toBe(123456);
      expect(result.transactionEnvelope).toBe("AAAAAA==");
    });

    it("should handle simulation failure", async () => {
      const mockRpcResponse = {
        result: {
          success: false,
          error: "Contract execution failed: insufficient balance",
          auth: [],
          events: [],
          transactionData: {
            resources: {
              footprint: {
                readOnly: [],
                readWrite: [],
              },
              instructions: 0,
              readBytes: 0,
              writeBytes: 0,
            },
            transactionSizeBytes: 0,
          },
          minResourceFee: "0",
        },
        latestLedger: 123456,
      };

      (StellarRpcClient as jest.Mock).mockImplementation(() => ({
        simulateTransaction: jest.fn().mockResolvedValue(mockRpcResponse),
      }));

      const result = await simulator.simulateContractCall(mockRequest);

      expect(result.success).toBe(false);
      expect(result.error).toContain("insufficient balance");
      expect(result.metrics.instructions).toBe(0);
    });

    it("should handle RPC errors gracefully", async () => {
      (StellarRpcClient as jest.Mock).mockImplementation(() => ({
        simulateTransaction: jest
          .fn()
          .mockRejectedValue(new Error("Network error")),
      }));

      const result = await simulator.simulateContractCall(mockRequest);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Network error");
      expect(result.metrics.instructions).toBe(0);
    });

    it("should extract comprehensive execution metrics", async () => {
      const mockRpcResponse = {
        result: {
          success: true,
          auth: [
            { address: "alice", nonce: 123 },
            { address: "bob", nonce: 456 },
          ],
          events: [
            {
              contract_id: testContractId,
              type: "system",
              topics: ["transfer"],
            },
            {
              contract_id: testContractId,
              type: "system",
              topics: ["approve"],
            },
          ],
          results: [{ auth: [], returnValue: "success" }],
          transactionData: {
            resources: {
              footprint: {
                readOnly: [
                  "ContractData(balance_alice)",
                  "ContractData(token_metadata)",
                ],
                readWrite: [
                  "ContractData(balance_bob)",
                  "ContractData(balance_alice)",
                ],
              },
              instructions: 2_500_000,
              readBytes: 1024,
              writeBytes: 512,
            },
            transactionSizeBytes: 8192,
          },
          minResourceFee: "250000",
        },
        latestLedger: 123457,
      };

      (StellarRpcClient as jest.Mock).mockImplementation(() => ({
        simulateTransaction: jest.fn().mockResolvedValue(mockRpcResponse),
      }));

      const result = await simulator.simulateContractCall(mockRequest);

      expect(result.success).toBe(true);
      expect(result.metrics.instructions).toBe(2_500_000);
      expect(result.metrics.ledgerReads).toBe(2);
      expect(result.metrics.ledgerWrites).toBe(2);
      expect(result.metrics.readBytes).toBe(1024);
      expect(result.metrics.writeBytes).toBe(512);
      expect(result.metrics.transactionSizeBytes).toBe(8192);
      expect(result.metrics.eventCount).toBe(2);
      expect(result.metrics.authCount).toBe(2);
      expect(result.metrics.minResourceFee).toBe(250000);
      expect(result.metrics.memoryBytes).toBeGreaterThan(0);
      expect(result.metrics.executionTime).toBeGreaterThanOrEqual(0);
    });

    it("should handle empty simulation results", async () => {
      const mockRpcResponse = {
        result: {
          success: true,
          auth: [],
          events: [],
          results: [],
          transactionData: {
            resources: {
              footprint: {
                readOnly: [],
                readWrite: [],
              },
              instructions: 0,
              readBytes: 0,
              writeBytes: 0,
            },
            transactionSizeBytes: 0,
          },
          minResourceFee: "0",
        },
        latestLedger: 123458,
      };

      (StellarRpcClient as jest.Mock).mockImplementation(() => ({
        simulateTransaction: jest.fn().mockResolvedValue(mockRpcResponse),
      }));

      const result = await simulator.simulateContractCall(mockRequest);

      expect(result.success).toBe(true);
      expect(result.metrics.instructions).toBe(0);
      expect(result.events).toEqual([]);
      expect(result.authEntries).toEqual([]);
    });
  });

  describe("simulateBatch", () => {
    it("should simulate multiple contract calls in parallel", async () => {
      const mockRpcResponse = {
        result: {
          success: true,
          auth: [],
          events: [],
          results: [{ auth: [], returnValue: "success" }],
          transactionData: {
            resources: {
              footprint: {
                readOnly: ["ContractData(balance)"],
                readWrite: [],
              },
              instructions: 500_000,
              readBytes: 256,
              writeBytes: 0,
            },
            transactionSizeBytes: 2048,
          },
          minResourceFee: "100000",
        },
        latestLedger: 123459,
      };

      (StellarRpcClient as jest.Mock).mockImplementation(() => ({
        simulateTransaction: jest.fn().mockResolvedValue(mockRpcResponse),
      }));

      const requests: StellarSimulationRequest[] = [
        {
          contractId: testContractId,
          method: "transfer",
          params: ["alice", "bob", 100],
          rpcUrl: testRpcUrl,
        },
        {
          contractId: testContractId,
          method: "transfer",
          params: ["charlie", "dave", 200],
          rpcUrl: testRpcUrl,
        },
        {
          contractId: testContractId,
          method: "balance",
          params: ["alice"],
          rpcUrl: testRpcUrl,
        },
      ];

      const results = await simulator.simulateBatch(requests);

      expect(results).toHaveLength(3);
      expect(results.every((r: StellarSimulationResult) => r.success)).toBe(
        true,
      );
      expect(
        results.every(
          (r: StellarSimulationResult) => r.metrics.instructions > 0,
        ),
      ).toBe(true);
    });

    it("should handle mixed success and failure in batch", async () => {
      const successResponse = {
        result: {
          success: true,
          auth: [],
          events: [],
          results: [{ auth: [], returnValue: "success" }],
          transactionData: {
            resources: {
              footprint: { readOnly: [], readWrite: [] },
              instructions: 500_000,
              readBytes: 0,
              writeBytes: 0,
            },
            transactionSizeBytes: 1024,
          },
          minResourceFee: "50000",
        },
        latestLedger: 123460,
      };

      const failureResponse = {
        result: {
          success: false,
          error: "Method not found",
          auth: [],
          events: [],
          transactionData: {
            resources: {
              footprint: { readOnly: [], readWrite: [] },
              instructions: 0,
              readBytes: 0,
              writeBytes: 0,
            },
            transactionSizeBytes: 0,
          },
          minResourceFee: "0",
        },
        latestLedger: 123460,
      };

      (StellarRpcClient as jest.Mock).mockImplementation(() => ({
        simulateTransaction: jest
          .fn()
          .mockResolvedValueOnce(successResponse)
          .mockResolvedValueOnce(failureResponse),
      }));

      const requests: StellarSimulationRequest[] = [
        {
          contractId: testContractId,
          method: "transfer",
          params: ["alice", "bob", 100],
          rpcUrl: testRpcUrl,
        },
        {
          contractId: testContractId,
          method: "invalid_method",
          params: [],
          rpcUrl: testRpcUrl,
        },
      ];

      const results = await simulator.simulateBatch(requests);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].error).toContain("Method not found");
    });
  });

  describe("Edge Cases", () => {
    it("should handle large instruction counts", async () => {
      const mockRpcResponse = {
        result: {
          success: true,
          auth: [],
          events: [],
          results: [{ auth: [], returnValue: "success" }],
          transactionData: {
            resources: {
              footprint: {
                readOnly: Array(40).fill("ContractData(entry)"),
                readWrite: Array(25).fill("ContractData(entry)"),
              },
              instructions: 95_000_000, // Close to limit
              readBytes: 190_000,
              writeBytes: 95_000,
            },
            transactionSizeBytes: 95_000,
          },
          minResourceFee: "5000000",
        },
        latestLedger: 123461,
      };

      (StellarRpcClient as jest.Mock).mockImplementation(() => ({
        simulateTransaction: jest.fn().mockResolvedValue(mockRpcResponse),
      }));

      const result = await simulator.simulateContractCall({
        contractId: testContractId,
        method: "batch_transfer",
        params: Array(100).fill("recipient"),
        rpcUrl: testRpcUrl,
      });

      expect(result.success).toBe(true);
      expect(result.metrics.instructions).toBe(95_000_000);
      expect(result.metrics.ledgerReads).toBe(40);
      expect(result.metrics.ledgerWrites).toBe(25);
    });

    it("should handle minimal transactions", async () => {
      const mockRpcResponse = {
        result: {
          success: true,
          auth: [],
          events: [],
          results: [{ auth: [], returnValue: "success" }],
          transactionData: {
            resources: {
              footprint: {
                readOnly: ["ContractData(counter)"],
                readWrite: [],
              },
              instructions: 10_000,
              readBytes: 64,
              writeBytes: 0,
            },
            transactionSizeBytes: 512,
          },
          minResourceFee: "10000",
        },
        latestLedger: 123462,
      };

      (StellarRpcClient as jest.Mock).mockImplementation(() => ({
        simulateTransaction: jest.fn().mockResolvedValue(mockRpcResponse),
      }));

      const result = await simulator.simulateContractCall({
        contractId: testContractId,
        method: "get_counter",
        params: [],
        rpcUrl: testRpcUrl,
      });

      expect(result.success).toBe(true);
      expect(result.metrics.instructions).toBe(10_000);
      expect(result.metrics.ledgerReads).toBe(1);
      expect(result.metrics.ledgerWrites).toBe(0);
    });

    it("should handle complex parameter types", async () => {
      const mockRpcResponse = {
        result: {
          success: true,
          auth: [],
          events: [],
          results: [{ auth: [], returnValue: "success" }],
          transactionData: {
            resources: {
              footprint: { readOnly: [], readWrite: [] },
              instructions: 100_000,
              readBytes: 0,
              writeBytes: 0,
            },
            transactionSizeBytes: 1024,
          },
          minResourceFee: "50000",
        },
        latestLedger: 123463,
      };

      (StellarRpcClient as jest.Mock).mockImplementation(() => ({
        simulateTransaction: jest.fn().mockResolvedValue(mockRpcResponse),
      }));

      const complexParams = [
        "string_value",
        12345,
        BigInt(999999999999),
        ["array", "of", "values"],
        { key1: "value1", key2: "value2" },
        Buffer.from("binary_data"),
      ];

      const result = await simulator.simulateContractCall({
        contractId: testContractId,
        method: "complex_function",
        params: complexParams,
        rpcUrl: testRpcUrl,
      });

      expect(result.success).toBe(true);
    });
  });

  describe("Metrics Estimation", () => {
    it("should estimate memory usage correctly", async () => {
      const mockRpcResponse = {
        result: {
          success: true,
          auth: [],
          events: [],
          results: [{ auth: [], returnValue: "success" }],
          transactionData: {
            resources: {
              footprint: {
                readOnly: ["ContractData(a)", "ContractData(b)"],
                readWrite: ["ContractData(c)"],
              },
              instructions: 1_000_000,
              readBytes: 1024,
              writeBytes: 512,
            },
            transactionSizeBytes: 2048,
          },
          minResourceFee: "100000",
        },
        latestLedger: 123464,
      };

      (StellarRpcClient as jest.Mock).mockImplementation(() => ({
        simulateTransaction: jest.fn().mockResolvedValue(mockRpcResponse),
      }));

      const result = await simulator.simulateContractCall({
        contractId: testContractId,
        method: "test",
        params: [],
        rpcUrl: testRpcUrl,
      });

      // Memory should be estimated based on:
      // - Base 1MB
      // - 3 entries * 4KB = 12KB
      // - (1024 + 512) * 2 = 3KB
      // - 1_000_000 * 10 = ~9.5MB
      expect(result.metrics.memoryBytes).toBeGreaterThan(10_000_000);
      expect(result.metrics.memoryBytes).toBeLessThan(15_000_000);
    });
  });
});
