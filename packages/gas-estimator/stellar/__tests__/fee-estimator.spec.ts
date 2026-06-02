/**
 * Unit Tests for Stellar Fee Estimation Engine
 *
 * Validates fee estimation accuracy, simulation-based calculations,
 * and acceptance criteria.
 */

import { StellarFeeEstimator, DEFAULT_NETWORK_CONFIGS } from "../fee-estimator";
import {
  SimulationResult,
  StellarNetworkConfig,
  FeeEstimationResult,
} from "../types";

describe("StellarFeeEstimator", () => {
  let estimator: StellarFeeEstimator;
  let testnetConfig: StellarNetworkConfig;

  beforeEach(() => {
    estimator = new StellarFeeEstimator();
    testnetConfig = DEFAULT_NETWORK_CONFIGS["soroban-testnet"];
  });

  /**
   * Helper to create a sample simulation result
   */
  const createSampleSimulation = (
    overrides: Partial<SimulationResult> = {},
  ): SimulationResult => ({
    instructions: 1_250_000,
    memoryBytes: 2_097_152, // 2 MB
    resources: {
      footprint: {
        readOnly: [
          "ContractData(token_balance_alice)",
          "ContractData(token_metadata)",
        ],
        readWrite: ["ContractData(token_balance_bob)"],
      },
      instructions: 1_250_000,
      readBytes: 512,
      writeBytes: 256,
    },
    transactionSizeBytes: 4096,
    ...overrides,
  });

  describe("Basic Fee Estimation", () => {
    it("should estimate fees from simulation results", async () => {
      const simulation = createSampleSimulation();

      const result = await estimator.estimateFromSimulation({
        simulation,
        networkConfig: testnetConfig,
      });

      expect(result).toBeDefined();
      expect(result.chainId).toBe("soroban-testnet");
      expect(result.totalFeeStroops).toBeGreaterThan(0);
      expect(result.totalFeeXLM).toBeGreaterThan(0);
    });

    it("should calculate correct CPU cost", async () => {
      const simulation = createSampleSimulation();

      const result = await estimator.estimateFromSimulation({
        simulation,
        networkConfig: testnetConfig,
      });

      // CPU fee = ⌈1,250,000 / 10,000⌉ × 100 = 125 × 100 = 12,500 stroops
      expect(result.cpuCost.fee).toBe(12500);
      expect(result.cpuCost.normalized).toBe(1_250_000 / 100_000_000);
      expect(result.cpuCost.total).toBeGreaterThanOrEqual(result.cpuCost.fee);
    });

    it("should calculate correct ledger cost", async () => {
      const simulation = createSampleSimulation();

      const result = await estimator.estimateFromSimulation({
        simulation,
        networkConfig: testnetConfig,
      });

      // Expected ledger fees:
      // Reads: 2 entries × 1000 + ⌈512/1024⌉ × 500 = 2000 + 500 = 2500
      // Writes: 1 entry × 2000 + ⌈256/1024⌉ × 1000 = 2000 + 1000 = 3000
      // Bandwidth: ⌈4096/1024⌉ × 100 = 4 × 100 = 400
      // Total: 2500 + 3000 + 400 = 5900 stroops
      expect(result.ledgerCost.fee).toBe(5900);
    });

    it("should convert stroops to XLM correctly", async () => {
      const simulation = createSampleSimulation();

      const result = await estimator.estimateFromSimulation({
        simulation,
        networkConfig: testnetConfig,
      });

      // 1 XLM = 10^7 stroops
      expect(result.totalFeeXLM).toBe(result.totalFeeStroops / 10_000_000);
    });

    it("should apply safety margin to total fees", async () => {
      const simulation = createSampleSimulation();

      const result = await estimator.estimateFromSimulation({
        simulation,
        networkConfig: testnetConfig,
        options: { safetyMargin: 1.15 },
      });

      const baseFee = result.cpuCost.total + result.ledgerCost.fee;
      const expectedWithMargin = Math.ceil(baseFee * 1.15);

      expect(result.totalFeeStroops).toBe(expectedWithMargin);
    });
  });

  describe("Priority-Based Estimation", () => {
    it("should apply different multipliers for priority levels", async () => {
      const simulation = createSampleSimulation();

      const lowResult = await estimator.estimateFromSimulation({
        simulation,
        networkConfig: testnetConfig,
        options: { priority: "low" },
      });

      const normalResult = await estimator.estimateFromSimulation({
        simulation,
        networkConfig: testnetConfig,
        options: { priority: "normal" },
      });

      const highResult = await estimator.estimateFromSimulation({
        simulation,
        networkConfig: testnetConfig,
        options: { priority: "high" },
      });

      const criticalResult = await estimator.estimateFromSimulation({
        simulation,
        networkConfig: testnetConfig,
        options: { priority: "critical" },
      });

      // Fees should increase with priority
      expect(lowResult.totalFeeStroops).toBeLessThan(
        normalResult.totalFeeStroops,
      );
      expect(normalResult.totalFeeStroops).toBeLessThan(
        highResult.totalFeeStroops,
      );
      expect(highResult.totalFeeStroops).toBeLessThan(
        criticalResult.totalFeeStroops,
      );
    });

    it("should use normal priority by default", async () => {
      const simulation = createSampleSimulation();

      const defaultResult = await estimator.estimateFromSimulation({
        simulation,
        networkConfig: testnetConfig,
      });

      const normalResult = await estimator.estimateFromSimulation({
        simulation,
        networkConfig: testnetConfig,
        options: { priority: "normal" },
      });

      expect(defaultResult.totalFeeStroops).toBe(normalResult.totalFeeStroops);
    });
  });

  describe("Efficiency Scoring", () => {
    it("should calculate efficiency scores", async () => {
      const simulation = createSampleSimulation();

      const result = await estimator.estimateFromSimulation({
        simulation,
        networkConfig: testnetConfig,
      });

      expect(result.scores).toBeDefined();
      expect(result.scores.cpu).toBeGreaterThanOrEqual(0);
      expect(result.scores.cpu).toBeLessThanOrEqual(100);
      expect(result.scores.memory).toBeGreaterThanOrEqual(0);
      expect(result.scores.memory).toBeLessThanOrEqual(100);
      expect(result.scores.ledger).toBeGreaterThanOrEqual(0);
      expect(result.scores.ledger).toBeLessThanOrEqual(100);
      expect(result.scores.total).toBeGreaterThanOrEqual(0);
      expect(result.scores.total).toBeLessThanOrEqual(100);
    });

    it("should give excellent scores for low resource usage", async () => {
      const simulation = createSampleSimulation({
        instructions: 1_000_000, // 1% of limit
        memoryBytes: 1_000_000, // ~2.4% of limit
        resources: {
          footprint: {
            readOnly: ["ContractData(balance)"],
            readWrite: [],
          },
          instructions: 1_000_000,
          readBytes: 256,
          writeBytes: 0,
        },
        transactionSizeBytes: 2048,
      });

      const result = await estimator.estimateFromSimulation({
        simulation,
        networkConfig: testnetConfig,
      });

      // Low usage should result in high scores
      expect(result.scores.cpu).toBeGreaterThan(80);
      expect(result.scores.ledger).toBeGreaterThan(80);
    });

    it("should give poor scores for high resource usage", async () => {
      const simulation = createSampleSimulation({
        instructions: 85_000_000, // 85% of limit
        memoryBytes: 35_000_000, // ~83% of limit
        resources: {
          footprint: {
            readOnly: Array(30).fill("ContractData(entry)"),
            readWrite: Array(20).fill("ContractData(entry)"),
          },
          instructions: 85_000_000,
          readBytes: 180_000,
          writeBytes: 90_000,
        },
        transactionSizeBytes: 90_000,
      });

      const result = await estimator.estimateFromSimulation({
        simulation,
        networkConfig: testnetConfig,
      });

      // High usage should result in low scores
      expect(result.scores.cpu).toBeLessThan(50);
      expect(result.scores.ledger).toBeLessThan(50);
    });
  });

  describe("Optimization Hints", () => {
    it("should generate hints for high CPU usage", async () => {
      const simulation = createSampleSimulation({
        instructions: 85_000_000, // 85% of limit
      });

      const result = await estimator.estimateFromSimulation({
        simulation,
        networkConfig: testnetConfig,
      });

      expect(result.optimizationHints.length).toBeGreaterThan(0);
      expect(
        result.optimizationHints.some((h: string) => h.includes("CPU")),
      ).toBeTruthy();
    });

    it("should generate hints for high memory usage", async () => {
      const simulation = createSampleSimulation({
        memoryBytes: 35_000_000, // ~83% of limit
      });

      const result = await estimator.estimateFromSimulation({
        simulation,
        networkConfig: testnetConfig,
      });

      expect(result.optimizationHints.length).toBeGreaterThan(0);
      expect(
        result.optimizationHints.some(
          (h: string) => h.includes("Memory") || h.includes("memory"),
        ),
      ).toBeTruthy();
    });

    it("should generate hints for high ledger usage", async () => {
      const simulation = createSampleSimulation({
        resources: {
          footprint: {
            readOnly: Array(32).fill("ContractData(entry)"), // 80% of limit
            readWrite: Array(20).fill("ContractData(entry)"), // 80% of limit
          },
          instructions: 1_250_000,
          readBytes: 180_000,
          writeBytes: 90_000,
        },
      });

      const result = await estimator.estimateFromSimulation({
        simulation,
        networkConfig: testnetConfig,
      });

      expect(result.optimizationHints.length).toBeGreaterThan(0);
      expect(
        result.optimizationHints.some(
          (h: string) =>
            h.includes("read") || h.includes("write") || h.includes("ledger"),
        ),
      ).toBeTruthy();
    });

    it("should show excellent message for efficient contracts", async () => {
      const simulation = createSampleSimulation({
        instructions: 500_000, // 0.5% of limit
        memoryBytes: 500_000, // ~1.2% of limit
        resources: {
          footprint: {
            readOnly: ["ContractData(balance)"],
            readWrite: [],
          },
          instructions: 500_000,
          readBytes: 128,
          writeBytes: 0,
        },
        transactionSizeBytes: 1024,
      });

      const result = await estimator.estimateFromSimulation({
        simulation,
        networkConfig: testnetConfig,
      });

      expect(result.optimizationHints).toContain(
        "✅ Excellent resource efficiency!",
      );
    });

    it("should not generate hints when disabled", async () => {
      const simulation = createSampleSimulation();

      const result = await estimator.estimateFromSimulation({
        simulation,
        networkConfig: testnetConfig,
        options: { includeHints: false },
      });

      expect(result.optimizationHints).toEqual([]);
    });
  });

  describe("Safety Violations", () => {
    it("should detect CPU safety violations", async () => {
      const simulation = createSampleSimulation({
        instructions: 96_000_000, // 96% of limit
      });

      const result = await estimator.estimateFromSimulation({
        simulation,
        networkConfig: testnetConfig,
      });

      expect(result.safetyViolations.length).toBeGreaterThan(0);
      expect(
        result.safetyViolations.some((v: string) => v.includes("CPU")),
      ).toBeTruthy();
    });

    it("should detect memory safety violations", async () => {
      const simulation = createSampleSimulation({
        memoryBytes: 40_000_000, // ~95.4% of limit
      });

      const result = await estimator.estimateFromSimulation({
        simulation,
        networkConfig: testnetConfig,
      });

      expect(result.safetyViolations.length).toBeGreaterThan(0);
      expect(
        result.safetyViolations.some((v: string) => v.includes("Memory")),
      ).toBeTruthy();
    });

    it("should detect ledger safety violations", async () => {
      const simulation = createSampleSimulation({
        resources: {
          footprint: {
            readOnly: Array(39).fill("ContractData(entry)"), // 97.5% of limit
            readWrite: [],
          },
          instructions: 1_250_000,
          readBytes: 195_000, // 97.5% of limit
          writeBytes: 0,
        },
      });

      const result = await estimator.estimateFromSimulation({
        simulation,
        networkConfig: testnetConfig,
      });

      expect(result.safetyViolations.length).toBeGreaterThan(0);
      expect(
        result.safetyViolations.some((v: string) => v.includes("read")),
      ).toBeTruthy();
    });

    it("should not check safety violations when disabled", async () => {
      const simulation = createSampleSimulation({
        instructions: 96_000_000,
      });

      const result = await estimator.estimateFromSimulation({
        simulation,
        networkConfig: testnetConfig,
        options: { includeSafetyChecks: false },
      });

      expect(result.safetyViolations).toEqual([]);
    });
  });

  describe("Confidence Calculation", () => {
    it("should give high confidence for normal usage", async () => {
      const simulation = createSampleSimulation();

      const result = await estimator.estimateFromSimulation({
        simulation,
        networkConfig: testnetConfig,
      });

      expect(result.confidence).toBeGreaterThanOrEqual(80);
      expect(result.confidence).toBeLessThanOrEqual(100);
    });

    it("should reduce confidence for high resource usage", async () => {
      const simulation = createSampleSimulation({
        instructions: 85_000_000,
        memoryBytes: 35_000_000,
        resources: {
          footprint: {
            readOnly: Array(30).fill("ContractData(entry)"),
            readWrite: Array(20).fill("ContractData(entry)"),
          },
          instructions: 85_000_000,
          readBytes: 180_000,
          writeBytes: 90_000,
        },
        transactionSizeBytes: 90_000,
      });

      const result = await estimator.estimateFromSimulation({
        simulation,
        networkConfig: testnetConfig,
      });

      expect(result.confidence).toBeLessThan(90);
    });
  });

  describe("Contract Simulation", () => {
    it("should estimate fees from contract simulation", async () => {
      // Mock simulation function
      const mockSimulate = jest
        .fn()
        .mockResolvedValue(createSampleSimulation());

      const result = await estimator.estimateFromContract(
        {
          contractCode: "wasm_code_here",
          method: "transfer",
          params: ["alice", "bob", 1000],
          networkConfig: testnetConfig,
        },
        mockSimulate,
      );

      expect(mockSimulate).toHaveBeenCalledWith("wasm_code_here", "transfer", [
        "alice",
        "bob",
        1000,
      ]);
      expect(result.totalFeeStroops).toBeGreaterThan(0);
    });

    it("should throw error when simulation reverts", async () => {
      const mockSimulate = jest.fn().mockResolvedValue({
        ...createSampleSimulation(),
        reverted: true,
        error: "Insufficient balance",
      });

      await expect(
        estimator.estimateFromContract(
          {
            contractCode: "wasm_code_here",
            method: "transfer",
            params: ["alice", "bob", 1000],
            networkConfig: testnetConfig,
          },
          mockSimulate,
        ),
      ).rejects.toThrow("Simulation reverted: Insufficient balance");
    });

    it("should throw error when contract code is missing", async () => {
      const mockSimulate = jest.fn();

      await expect(
        estimator.estimateFromContract(
          {
            method: "transfer",
            params: ["alice", "bob", 1000],
            networkConfig: testnetConfig,
          } as any,
          mockSimulate,
        ),
      ).rejects.toThrow("Contract code is required for simulation");
    });
  });

  describe("Network Configuration", () => {
    it("should get default config for known chains", () => {
      const mainnetConfig =
        StellarFeeEstimator.getDefaultConfig("soroban-mainnet");
      expect(mainnetConfig.chainId).toBe("soroban-mainnet");
      expect(mainnetConfig.txMaxInstructions).toBe(100_000_000);

      const testnetConfig =
        StellarFeeEstimator.getDefaultConfig("soroban-testnet");
      expect(testnetConfig.chainId).toBe("soroban-testnet");
    });

    it("should throw error for unknown chains", () => {
      expect(() => {
        StellarFeeEstimator.getDefaultConfig("unknown-chain");
      }).toThrow("No default configuration for chain: unknown-chain");
    });

    it("should register custom network configurations", () => {
      const customConfig: StellarNetworkConfig = {
        chainId: "soroban-custom",
        chainName: "Custom Network",
        txMaxInstructions: 50_000_000,
        ledgerMaxInstructions: 500_000_000,
        feeRatePerInstructionsIncrement: 5000,
        feeCPUPerIncrement: 50,
        txMemoryLimit: 20_971_520,
        txMaxReadLedgerEntries: 20,
        txMaxReadBytes: 100_000,
        txMaxWriteLedgerEntries: 15,
        txMaxWriteBytes: 50_000,
        feeReadLedgerEntry: 500,
        feeWriteLedgerEntry: 1000,
        feeRead1KB: 250,
        feeWrite1KB: 500,
        txMaxSizeBytes: 50_000,
        feeTxSize1KB: 50,
        version: "custom-v1",
      };

      StellarFeeEstimator.registerNetworkConfig(customConfig);

      const retrieved = StellarFeeEstimator.getDefaultConfig("soroban-custom");
      expect(retrieved.chainId).toBe("soroban-custom");
      expect(retrieved.txMaxInstructions).toBe(50_000_000);
    });
  });

  describe("Edge Cases", () => {
    it("should handle zero instructions", async () => {
      const simulation = createSampleSimulation({
        instructions: 0,
        resources: {
          footprint: {
            readOnly: [],
            readWrite: [],
          },
          instructions: 0,
          readBytes: 0,
          writeBytes: 0,
        },
      });

      const result = await estimator.estimateFromSimulation({
        simulation,
        networkConfig: testnetConfig,
      });

      expect(result.cpuCost.fee).toBe(0);
      expect(result.totalFeeStroops).toBeGreaterThanOrEqual(0);
    });

    it("should handle minimal transaction", async () => {
      const simulation = createSampleSimulation({
        instructions: 1000,
        memoryBytes: 1024,
        resources: {
          footprint: {
            readOnly: ["ContractData(minimal)"],
            readWrite: [],
          },
          instructions: 1000,
          readBytes: 64,
          writeBytes: 0,
        },
        transactionSizeBytes: 512,
      });

      const result = await estimator.estimateFromSimulation({
        simulation,
        networkConfig: testnetConfig,
      });

      expect(result.totalFeeStroops).toBeGreaterThan(0);
      expect(result.scores.total).toBeGreaterThan(0);
    });

    it("should handle maximum resource usage", async () => {
      const simulation = createSampleSimulation({
        instructions: 99_000_000,
        memoryBytes: 41_000_000,
        resources: {
          footprint: {
            readOnly: Array(38).fill("ContractData(entry)"),
            readWrite: Array(24).fill("ContractData(entry)"),
          },
          instructions: 99_000_000,
          readBytes: 199_000,
          writeBytes: 99_000,
        },
        transactionSizeBytes: 99_000,
      });

      const result = await estimator.estimateFromSimulation({
        simulation,
        networkConfig: testnetConfig,
      });

      expect(result.totalFeeStroops).toBeGreaterThan(0);
      expect(result.safetyViolations.length).toBeGreaterThan(0);
    });
  });

  describe("Real-World Scenarios", () => {
    it("should estimate simple token transfer correctly", async () => {
      // Typical token transfer simulation
      const simulation = createSampleSimulation({
        instructions: 1_250_000,
        memoryBytes: 2_097_152,
        resources: {
          footprint: {
            readOnly: [
              "ContractData(token_balance_alice)",
              "ContractData(token_metadata)",
            ],
            readWrite: ["ContractData(token_balance_bob)"],
          },
          instructions: 1_250_000,
          readBytes: 512,
          writeBytes: 256,
        },
        transactionSizeBytes: 4096,
      });

      const result = await estimator.estimateFromSimulation({
        simulation,
        networkConfig: testnetConfig,
      });

      // Validate expected costs
      expect(result.cpuCost.fee).toBe(12500); // ⌈1,250,000/10,000⌉ × 100
      expect(result.ledgerCost.fee).toBe(5900); // 2500 + 3000 + 400

      // Total should include safety margin
      const baseFee = result.cpuCost.total + result.ledgerCost.fee;
      expect(result.totalFeeStroops).toBe(Math.ceil(baseFee * 1.15));

      // Should have excellent efficiency
      expect(result.scores.total).toBeGreaterThan(80);
      expect(result.optimizationHints).toContain(
        "✅ Excellent resource efficiency!",
      );
    });

    it("should estimate batch operation correctly", async () => {
      // Batch transfer to multiple recipients
      const simulation = createSampleSimulation({
        instructions: 5_000_000,
        memoryBytes: 8_000_000,
        resources: {
          footprint: {
            readOnly: [
              "ContractData(token_metadata)",
              "ContractData(sender_balance)",
            ],
            readWrite: [
              "ContractData(recipient1_balance)",
              "ContractData(recipient2_balance)",
              "ContractData(recipient3_balance)",
              "ContractData(recipient4_balance)",
              "ContractData(recipient5_balance)",
            ],
          },
          instructions: 5_000_000,
          readBytes: 1024,
          writeBytes: 2560,
        },
        transactionSizeBytes: 8192,
      });

      const result = await estimator.estimateFromSimulation({
        simulation,
        networkConfig: testnetConfig,
      });

      expect(result.cpuCost.fee).toBe(50000); // ⌈5,000,000/10,000⌉ × 100
      expect(result.ledgerCost.fee).toBeGreaterThan(0);
      expect(result.scores.total).toBeGreaterThan(0);
    });
  });
});
