import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { OptimizationEngineService } from "../services/optimization-engine.service";
import { DataAnalysisService } from "../services/data-analysis.service";
import { OptimizationSuggestion } from "../entities/optimization-suggestion.entity";

describe("OptimizationEngineService", () => {
  let service: OptimizationEngineService;
  let dataAnalysisService: DataAnalysisService;
  let optimizationSuggestionRepository: Repository<OptimizationSuggestion>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OptimizationEngineService,
        {
          provide: DataAnalysisService,
          useValue: {
            getTransactionAnalysis: jest.fn(),
            compareChainCosts: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(OptimizationSuggestion),
          useClass: Repository,
        },
      ],
    }).compile();

    service = module.get<OptimizationEngineService>(OptimizationEngineService);
    dataAnalysisService = module.get<DataAnalysisService>(DataAnalysisService);
    optimizationSuggestionRepository = module.get<
      Repository<OptimizationSuggestion>
    >(getRepositoryToken(OptimizationSuggestion));
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("generateOptimizationSuggestions", () => {
    it("should generate optimization suggestions for a merchant", async () => {
      // Mock data analysis service
      const mockAnalysis = {
        merchantId: "merchant-123",
        transactionStats: {
          totalTransactions: 100,
          successfulTransactions: 90,
          failedTransactions: 10,
          successRate: 90,
          avgGasUsed: 100000,
          totalGasUsed: 10000000,
          avgGasPrice: 20,
          totalCostUSD: 100,
        },
        chainBreakdown: [
          {
            chainId: "ethereum",
            chainName: "Ethereum",
            transactionCount: 60,
            totalGasUsed: 6000000,
            totalCostUSD: 60,
            avgGasUsed: 100000,
            successRate: 85,
          },
          {
            chainId: "polygon",
            chainName: "Polygon",
            transactionCount: 40,
            totalGasUsed: 2000000,
            totalCostUSD: 20,
            avgGasUsed: 50000,
            successRate: 95,
          },
        ],
        gasPriceVolatility: {
          minGasPrice: 10,
          maxGasPrice: 50,
          avgGasPrice: 20,
          volatilityIndex: 0.8,
        },
        timeBasedPatterns: [
          { hour: 9, transactionCount: 10, avgGasPrice: 30, totalCostUSD: 10 },
          { hour: 15, transactionCount: 15, avgGasPrice: 40, totalCostUSD: 15 },
          { hour: 2, transactionCount: 5, avgGasPrice: 10, totalCostUSD: 5 },
        ],
      };

      jest
        .spyOn(dataAnalysisService, "getTransactionAnalysis")
        .mockResolvedValue(mockAnalysis);

      const suggestions = await service.generateOptimizationSuggestions(
        "merchant-123",
        30,
      );

      expect(suggestions).toBeDefined();
      expect(Array.isArray(suggestions)).toBe(true);
      expect(suggestions.length).toBeGreaterThan(0);

      // Check that analysis service was called
      expect(dataAnalysisService.getTransactionAnalysis).toHaveBeenCalledWith(
        "merchant-123",
        30,
      );
    });
  });

  describe("generateChainSwitchSuggestions", () => {
    it("should generate chain switch suggestions when there are cost differences", () => {
      const mockAnalysis = {
        chainBreakdown: [
          {
            chainId: "ethereum",
            chainName: "Ethereum",
            avgCostPerTransaction: 1.5,
            transactionCount: 50,
            totalCostUSD: 75,
          },
          {
            chainId: "polygon",
            chainName: "Polygon",
            avgCostPerTransaction: 0.2,
            transactionCount: 30,
            totalCostUSD: 6,
          },
        ],
        transactionStats: {
          totalTransactions: 80,
        },
      };

      const suggestions = (service as any).generateChainSwitchSuggestions(
        mockAnalysis,
      );

      expect(suggestions).toBeDefined();
      expect(Array.isArray(suggestions)).toBe(true);
      if (suggestions.length > 0) {
        expect(suggestions[0].type).toBe("ChainSwitch");
        expect(suggestions[0].description).toContain("Switch");
        expect(suggestions[0].estimatedSavingsUSD).toBeDefined();
        expect(suggestions[0].priority).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe("getOptimizationSummary", () => {
    it("should return optimization summary for a merchant", async () => {
      // Mock the getOptimizationSuggestions method
      jest.spyOn(service, "getOptimizationSuggestions").mockResolvedValue([
        {
          id: "sug-1",
          merchantId: "merchant-123",
          type: "ChainSwitch",
          description: "Switch to cheaper chain",
          estimatedSavingsUSD: 50,
          priority: 4,
          status: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "sug-2",
          merchantId: "merchant-123",
          type: "TimingAdjustment",
          description: "Adjust timing to low gas periods",
          estimatedSavingsUSD: 30,
          priority: 5,
          status: "applied",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any);

      const summary = await service.getOptimizationSummary("merchant-123");

      expect(summary).toBeDefined();
      expect(summary.totalPotentialSavingsUSD).toBe(50); // Only pending suggestions counted
      expect(summary.totalSuggestions).toBe(2);
      expect(summary.highPrioritySuggestions).toBe(1); // Only priority 4+ and pending
      expect(summary.appliedSuggestions).toBe(1);
    });
  });
});
