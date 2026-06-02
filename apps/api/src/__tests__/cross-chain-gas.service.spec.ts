import { Test, TestingModule } from "@nestjs/testing";
import { CrossChainGasService } from "../services/cross-chain-gas.service";
import { CrossChainGasRequest } from "../schemas/cross-chain-gas.schema";

describe("CrossChainGasService", () => {
  let service: CrossChainGasService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CrossChainGasService],
    }).compile();

    service = module.get<CrossChainGasService>(CrossChainGasService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("getCrossChainGasComparison", () => {
    it("should return comparison for transfer transaction", async () => {
      const request: CrossChainGasRequest = {
        txType: "transfer",
      };

      const result = await service.getCrossChainGasComparison(request);

      expect(result).toHaveProperty("txType", "transfer");
      expect(result).toHaveProperty("timestamp");
      expect(result).toHaveProperty("chains");
      expect(result.chains).toBeInstanceOf(Array);
      expect(result.chains.length).toBeGreaterThan(0);
    });

    it("should return comparison for contract-call transaction", async () => {
      const request: CrossChainGasRequest = {
        txType: "contract-call",
      };

      const result = await service.getCrossChainGasComparison(request);

      expect(result.txType).toBe("contract-call");
      expect(result.chains).toBeDefined();
    });

    it("should return comparison for swap transaction", async () => {
      const request: CrossChainGasRequest = {
        txType: "swap",
      };

      const result = await service.getCrossChainGasComparison(request);

      expect(result.txType).toBe("swap");
      expect(result.chains).toBeDefined();
    });

    it("should rank chains by cost (lowest first)", async () => {
      const request: CrossChainGasRequest = {
        txType: "transfer",
      };

      const result = await service.getCrossChainGasComparison(request);

      const costs = result.chains.map((chain) => chain.estimatedCostUSD);
      const sortedCosts = [...costs].sort((a, b) => a - b);

      expect(costs).toEqual(sortedCosts);
      expect(result.chains[0].rank).toBe(1);
    });

    it("should include all supported chains", async () => {
      const request: CrossChainGasRequest = {
        txType: "transfer",
      };

      const result = await service.getCrossChainGasComparison(request);

      const chainIds = result.chains.map((chain) => chain.chainId);
      expect(chainIds).toContain(1); // Ethereum
      expect(chainIds).toContain(137); // Polygon
      expect(chainIds).toContain(56); // BSC
      expect(chainIds).toContain(42161); // Arbitrum
      expect(chainIds).toContain(10); // Optimism
    });
  });

  describe("getSupportedChains", () => {
    it("should return all supported chains", async () => {
      const chains = await service.getSupportedChains();

      expect(chains).toBeInstanceOf(Array);
      expect(chains.length).toBe(5);

      const chainIds = chains.map((chain) => chain.chainId);
      expect(chainIds).toContain(1);
      expect(chainIds).toContain(137);
      expect(chainIds).toContain(56);
      expect(chainIds).toContain(42161);
      expect(chainIds).toContain(10);
    });

    it("should include required chain properties", async () => {
      const chains = await service.getSupportedChains();

      chains.forEach((chain) => {
        expect(chain).toHaveProperty("chainId");
        expect(chain).toHaveProperty("chainName");
        expect(chain).toHaveProperty("nativeToken");
        expect(chain).toHaveProperty("rpcUrl");
        expect(chain).toHaveProperty("blockTime");
      });
    });
  });

  describe("gas cost normalization", () => {
    it("should normalize costs correctly for different chains", async () => {
      const request: CrossChainGasRequest = {
        txType: "transfer",
      };

      const result = await service.getCrossChainGasComparison(request);

      result.chains.forEach((chain) => {
        expect(chain.estimatedCostUSD).toBeGreaterThan(0);
        expect(chain.estimatedCostNative).toBeDefined();
        expect(chain.averageConfirmationTime).toBeDefined();
        expect(chain.rank).toBeGreaterThan(0);
      });
    });

    it("should calculate USD costs correctly", async () => {
      const request: CrossChainGasRequest = {
        txType: "transfer",
      };

      const result = await service.getCrossChainGasComparison(request);

      const polygonChain = result.chains.find((chain) => chain.chainId === 137);
      const ethereumChain = result.chains.find((chain) => chain.chainId === 1);

      // Polygon should be cheaper than Ethereum for transfers
      expect(polygonChain!.estimatedCostUSD).toBeLessThan(
        ethereumChain!.estimatedCostUSD,
      );
    });
  });
});
