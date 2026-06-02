import { Test, TestingModule } from "@nestjs/testing";
import { FailedTransactionService } from "../services/failed-transaction.service";
import {
  FailureCategory,
  FailedTransaction,
} from "../schemas/failed-transaction.schema";

describe("FailedTransactionService", () => {
  let service: FailedTransactionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FailedTransactionService],
    }).compile();

    service = module.get<FailedTransactionService>(FailedTransactionService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("trackFailedTransaction", () => {
    it("should track a failed transaction with underpriced gas", async () => {
      const transactionData = {
        hash: "0x1234567890abcdef1234567890abcdef12345678",
        wallet: "0xabcdef1234567890abcdef1234567890abcdef12",
        chainId: 1,
        gasUsed: "21000",
        gasPrice: "10000000000", // 10 gwei, below network price
        metadata: {
          nonce: 1,
          gasLimit: "21000",
          transactionType: "legacy" as const,
        },
      };

      const result = await service.trackFailedTransaction(transactionData);

      expect(result.failureCategory).toBe("underpriced_gas");
      expect(result.hash).toBe(transactionData.hash);
      expect(result.wallet).toBe(transactionData.wallet);
    });

    it("should track a failed transaction with out of gas", async () => {
      const transactionData = {
        hash: "0x123",
        wallet: "0xabc",
        chainId: 1,
        gasUsed: "21000",
        gasPrice: "100000000000", // 100 gwei - very high to bypass underpriced check
        gasLimit: "21000",
        status: 0,
        revertReason: "exceeded transaction gas",
        timestamp: new Date().toISOString(),
        metadata: {
          nonce: 1,
          gasLimit: "21000",
          transactionType: "legacy" as const,
        },
      };

      const result = await service.trackFailedTransaction(transactionData);

      expect(result.failureCategory).toBe("out_of_gas");
      expect(result.effectiveFee).toBe(
        (
          BigInt(transactionData.gasUsed) * BigInt(transactionData.gasPrice)
        ).toString(),
      );
    });

    it("should track a failed transaction with insufficient balance", async () => {
      const transactionData = {
        hash: "0x456",
        wallet: "0xdef",
        chainId: 1,
        gasUsed: "150000",
        gasPrice: "20000000000",
        revertReason: "UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT",
        metadata: {
          nonce: 3,
          gasLimit: "200000",
          transactionType: "legacy" as const,
        },
      };

      const result = await service.trackFailedTransaction(transactionData);

      expect(result.failureCategory).toBe("slippage_exceeded");
      expect(result.revertReason).toContain("INSUFFICIENT_OUTPUT_AMOUNT");
    });

    it("should track a failed transaction with nonce conflict", async () => {
      const wallet = "0xabcdef1234567890abcdef1234567890abcdef12";
      const nonce = 4;

      // First transaction
      await service.trackFailedTransaction({
        hash: "0x1234567890abcdef1234567890abcdef1234567b",
        wallet,
        chainId: 1,
        gasUsed: "21000",
        gasPrice: "20000000000",
        metadata: {
          nonce,
          gasLimit: "21000",
          transactionType: "legacy" as const,
        },
      });

      // Second transaction with same nonce (within 5 minutes)
      const result = await service.trackFailedTransaction({
        hash: "0x1234567890abcdef1234567890abcdef1234567c",
        wallet,
        chainId: 1,
        gasUsed: "21000",
        gasPrice: "20000000000",
        metadata: {
          nonce,
          gasLimit: "21000",
          transactionType: "legacy" as const,
        },
      });

      expect(result.failureCategory).toBe("nonce_conflict");
    });
  });

  describe("getWalletFailures", () => {
    const wallet = "0xabcdef1234567890abcdef1234567890abcdef12";

    beforeEach(async () => {
      // Add some test transactions
      await service.trackFailedTransaction({
        hash: "0x1111111111111111111111111111111111111111",
        wallet,
        chainId: 1,
        gasUsed: "21000",
        gasPrice: "20000000000",
        metadata: {
          nonce: 1,
          gasLimit: "21000",
          transactionType: "legacy" as const,
        },
      });

      await service.trackFailedTransaction({
        hash: "0x2222222222222222222222222222222222222222",
        wallet,
        chainId: 137,
        gasUsed: "50000",
        gasPrice: "30000000000",
        metadata: {
          nonce: 2,
          gasLimit: "100000",
          transactionType: "legacy" as const,
        },
      });
    });

    it("should return all failures for a wallet", async () => {
      const failures = await service.getWalletFailures(wallet);
      expect(failures).toHaveLength(2);
      expect(failures[0].wallet).toBe(wallet);
      expect(failures[1].wallet).toBe(wallet);
    });

    it("should filter failures by chain ID", async () => {
      const failures = await service.getWalletFailures(wallet, [1]);
      expect(failures).toHaveLength(1);
      expect(failures[0].chainId).toBe(1);
    });
  });

  describe("calculateCostMetrics", () => {
    const wallet = "0xabcdef1234567890abcdef1234567890abcdef12";

    beforeEach(async () => {
      await service.trackFailedTransaction({
        hash: "0x3333333333333333333333333333333333333333",
        wallet,
        chainId: 1,
        gasUsed: "21000",
        gasPrice: "20000000000",
        metadata: {
          nonce: 1,
          gasLimit: "21000",
          transactionType: "legacy" as const,
        },
      });

      await service.trackFailedTransaction({
        hash: "0x4444444444444444444444444444444444444444",
        wallet,
        chainId: 1,
        gasUsed: "150000",
        gasPrice: "30000000000",
        metadata: {
          nonce: 2,
          gasLimit: "200000",
          transactionType: "legacy" as const,
        },
      });
    });

    it("should calculate total gas wasted correctly", async () => {
      const metrics = await service.calculateCostMetrics(wallet);

      const expectedTotal =
        BigInt(21000) * BigInt(20000000000) +
        BigInt(150000) * BigInt(30000000000);

      expect(metrics.totalGasWasted).toBe(expectedTotal.toString());
      expect(metrics.totalGasWastedUSD).toBeGreaterThan(0);
    });

    it("should calculate average waste per failure", async () => {
      const metrics = await service.calculateCostMetrics(wallet);

      const totalWaste = BigInt(metrics.totalGasWasted);
      const expectedAverage = totalWaste / BigInt(2);

      expect(metrics.averageWastePerFailure).toBe(expectedAverage.toString());
    });
  });
});
