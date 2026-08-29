import { GasDeltaEvaluator } from "../src/gas-delta-evaluator";
import { EvmOpcodeCalculator } from "../src/evm-opcode-calculator";
import { SorobanResourceCalculator } from "../src/soroban-resource-calculator";
import axios from "axios";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("Real-Time Gas & Fee Delta Estimation Engine", () => {
  let evaluator: GasDeltaEvaluator;
  let evmCalc: EvmOpcodeCalculator;
  let sorobanCalc: SorobanResourceCalculator;

  beforeEach(() => {
    jest.clearAllMocks();
    evaluator = new GasDeltaEvaluator();
    evmCalc = new EvmOpcodeCalculator();
    sorobanCalc = new SorobanResourceCalculator();
  });

  describe("EVM Opcode Calculator", () => {
    it("should calculate gas delta for inefficient storage access", () => {
      const result = evmCalc.calculateDelta("inefficient-storage-access", 3, { isCold: true });
      expect(result.deltaGas).toBeGreaterThan(0);
      expect(result.percentageReduction).toBeGreaterThan(0);
      expect(result.description).toContain("Cached 3 state variable reads");
    });

    it("should calculate gas delta for unchecked math operations", () => {
      const result = evmCalc.calculateDelta("unchecked-math-operations", 5);
      expect(result.deltaGas).toBe(85 * 5); // 85 gas saved per occurrence
      expect(result.percentageReduction).toBeCloseTo(89.47, 1);
    });

    it("should calculate gas delta for redundant external calls", () => {
      const result = evmCalc.calculateDelta("repeated-external-calls", 2, { isCold: true });
      expect(result.deltaGas).toBe(2600 - 3); // 2600 cold call vs 3 memory read
    });
  });

  describe("Soroban Resource Calculator", () => {
    it("should calculate resource delta for unused state variables", () => {
      const result = sorobanCalc.calculateDelta("soroban-unused-state-variables", 1, { dataSize: 64 });
      expect(result.delta.instructions).toBe(30000);
      expect(result.delta.readEntries).toBe(1);
      expect(result.delta.writeEntries).toBe(1);
      expect(result.deltaFeeStroops).toBe(4800);
    });

    it("should calculate resource delta for inefficient integers in loop", () => {
      const result = sorobanCalc.calculateDelta("soroban-inefficient-integers", 2, { loopIterations: 10 });
      expect(result.delta.instructions).toBe(4990 * 2 * 10);
      expect(result.deltaFeeStroops).toBe(1000); // 10 increments of 10k instructions = 10 * 100 stroops
    });
  });

  describe("Gas Delta Evaluator with Cached Pricing", () => {
    it("should fetch coin price from coingecko and fall back on error", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          ethereum: { usd: 3200 },
        },
      });

      const priceEth = await evaluator.getNativeTokenPrice("ETH");
      expect(priceEth).toBe(3200);

      mockedAxios.get.mockRejectedValueOnce(new Error("API rate limit"));
      const priceEthFallback = await evaluator.getNativeTokenPrice("ETH");
      expect(priceEthFallback).toBe(3500); // fallback price
    });

    it("should evaluate delta savings for Solidity contract", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          ethereum: { usd: 3000 },
        },
      });

      const result = await evaluator.evaluateDelta({
        language: "solidity",
        ruleName: "unchecked-math-operations",
        occurrences: 10,
        annualExecutionVolume: 1000000,
        gasPriceGweiOrStroop: 0.1, // 0.1 Gwei typical L2
      });

      expect(result.language).toBe("solidity");
      expect(result.deltaGasOrStroops).toBe(850);
      expect(result.tokenPriceUsd).toBe(3000);
      // Saved per execution: 850 gas * 0.1 Gwei = 85 Gwei = 0.000000085 ETH
      expect(result.nativeTokenSavedPerExecution).toBeCloseTo(0.000000085, 12);
      // 0.000000085 ETH * 3000 USD/ETH = 0.000255 USD
      expect(result.usdSavedPerExecution).toBeCloseTo(0.000255, 6);
      // Annual volume of 1,000,000 -> 0.085 ETH
      expect(result.estimatedAnnualNativeSavings).toBeCloseTo(0.085, 6);
      expect(result.estimatedAnnualUsdSavings).toBe(255);
    });

    it("should evaluate delta savings for Soroban contract", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          stellar: { usd: 0.1 },
        },
      });

      const result = await evaluator.evaluateDelta({
        language: "soroban",
        ruleName: "soroban-unused-state-variables",
        occurrences: 2,
        annualExecutionVolume: 500000,
      });

      expect(result.language).toBe("soroban");
      expect(result.deltaGasOrStroops).toBe(8100);
      expect(result.tokenPriceUsd).toBe(0.1);
      // Saved per execution: 8100 stroops = 0.00081 XLM
      expect(result.nativeTokenSavedPerExecution).toBeCloseTo(0.00081, 8);
      // 0.00081 XLM * 0.1 USD/XLM = 0.000081 USD
      expect(result.usdSavedPerExecution).toBeCloseTo(0.000081, 8);
      // Annual volume of 500,000 -> 405 XLM
      expect(result.estimatedAnnualNativeSavings).toBe(405);
      expect(result.estimatedAnnualUsdSavings).toBe(40.50);
    });
  });
});
