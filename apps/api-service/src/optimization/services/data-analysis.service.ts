import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, Between } from "typeorm";
import { Transaction } from "../../database/entities/transaction.entity";
import { Chain } from "../../database/entities/chain.entity";
import { Merchant } from "../../database/entities/merchant.entity";

@Injectable()
export class DataAnalysisService {
  private readonly logger = new Logger(DataAnalysisService.name);

  constructor(
    @InjectRepository(Transaction)
    private transactionRepository: Repository<Transaction>,
    @InjectRepository(Chain)
    private chainRepository: Repository<Chain>,
    @InjectRepository(Merchant)
    private merchantRepository: Repository<Merchant>,
  ) {}

  /**
   * Aggregate merchant transaction data for analysis
   */
  async analyzeMerchantTransactions(
    merchantId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<{
    merchantId: string;
    transactionStats: {
      totalTransactions: number;
      successfulTransactions: number;
      failedTransactions: number;
      successRate: number;
      avgGasUsed: number;
      totalGasUsed: number;
      avgGasPrice: number;
      totalCostUSD: number;
    };
    chainBreakdown: Array<{
      chainId: string;
      chainName: string;
      transactionCount: number;
      totalGasUsed: number;
      totalCostUSD: number;
      avgGasUsed: number;
      successRate: number;
    }>;
    gasPriceVolatility: {
      minGasPrice: number;
      maxGasPrice: number;
      avgGasPrice: number;
      volatilityIndex: number; // 0-1 scale, higher means more volatile
    };
    timeBasedPatterns: Array<{
      hour: number; // 0-23
      transactionCount: number;
      avgGasPrice: number;
      totalCostUSD: number;
    }>;
  }> {
    try {
      // Get all transactions for the merchant in the specified period
      const transactions = await this.transactionRepository.find({
        where: {
          merchantId,
          createdAt: Between(startDate, endDate),
        },
      });

      if (transactions.length === 0) {
        throw new Error(
          `No transactions found for merchant ${merchantId} in the specified period`,
        );
      }

      // Calculate overall statistics
      let totalGasUsed = 0;
      let totalCostUSD = 0;
      let successfulTransactions = 0;
      let totalGasPrice = 0;

      // Group transactions by chain
      const chainMap = new Map<
        string,
        {
          transactionCount: number;
          totalGasUsed: number;
          totalCostUSD: number;
          successfulTransactions: number;
        }
      >();

      // Group transactions by hour for time-based analysis
      const hourlyMap = new Map<
        number,
        {
          transactionCount: number;
          totalGasPriceSum: number;
          totalCostUSD: number;
        }
      >();

      for (const transaction of transactions) {
        // Overall stats
        totalGasUsed += Number(transaction.gasUsed || 0);
        totalCostUSD += Number(transaction.transactionFee || 0);

        if (transaction.gasPrice) {
          totalGasPrice += Number(transaction.gasPrice);
        }

        if (transaction.status === "success") {
          successfulTransactions++;
        }

        // Chain breakdown
        if (!chainMap.has(transaction.chainId)) {
          chainMap.set(transaction.chainId, {
            transactionCount: 0,
            totalGasUsed: 0,
            totalCostUSD: 0,
            successfulTransactions: 0,
          });
        }

        const chainData = chainMap.get(transaction.chainId)!;
        chainData.transactionCount++;
        chainData.totalGasUsed += Number(transaction.gasUsed || 0);
        chainData.totalCostUSD += Number(transaction.transactionFee || 0);
        if (transaction.status === "success") {
          chainData.successfulTransactions++;
        }

        // Hourly breakdown
        const hour = new Date(transaction.createdAt).getUTCHours();
        if (!hourlyMap.has(hour)) {
          hourlyMap.set(hour, {
            transactionCount: 0,
            totalGasPriceSum: 0,
            totalCostUSD: 0,
          });
        }

        const hourData = hourlyMap.get(hour)!;
        hourData.transactionCount++;
        if (transaction.gasPrice) {
          hourData.totalGasPriceSum += Number(transaction.gasPrice);
        }
        hourData.totalCostUSD += Number(transaction.transactionFee || 0);
      }

      // Get chain names for the breakdown
      const chainIds = Array.from(chainMap.keys());
      const chains = await this.chainRepository.findByIds(chainIds);
      const chainNameMap = new Map(
        chains.map((chain) => [chain.id, chain.name]),
      );

      const chainBreakdown = Array.from(chainMap.entries()).map(
        ([chainId, data]) => ({
          chainId,
          chainName: chainNameMap.get(chainId) || chainId,
          transactionCount: data.transactionCount,
          totalGasUsed: data.totalGasUsed,
          totalCostUSD: data.totalCostUSD,
          avgGasUsed:
            data.transactionCount > 0
              ? data.totalGasUsed / data.transactionCount
              : 0,
          successRate:
            data.transactionCount > 0
              ? (data.successfulTransactions / data.transactionCount) * 100
              : 0,
        }),
      );

      // Calculate gas price volatility
      const avgGasPrice =
        transactions.length > 0 ? totalGasPrice / transactions.length : 0;
      let minGasPrice = Infinity;
      let maxGasPrice = -Infinity;

      for (const transaction of transactions) {
        if (transaction.gasPrice) {
          const gasPrice = Number(transaction.gasPrice);
          if (gasPrice < minGasPrice) minGasPrice = gasPrice;
          if (gasPrice > maxGasPrice) maxGasPrice = gasPrice;
        }
      }

      // If no min/max found, default to avg
      if (minGasPrice === Infinity) minGasPrice = avgGasPrice;
      if (maxGasPrice === -Infinity) maxGasPrice = avgGasPrice;

      const gasPriceVolatility = {
        minGasPrice,
        maxGasPrice,
        avgGasPrice,
        volatilityIndex:
          maxGasPrice > 0 ? (maxGasPrice - minGasPrice) / maxGasPrice : 0,
      };

      // Prepare hourly patterns
      const timeBasedPatterns = Array.from(hourlyMap.entries())
        .map(([hour, data]) => ({
          hour,
          transactionCount: data.transactionCount,
          avgGasPrice:
            data.transactionCount > 0
              ? data.totalGasPriceSum / data.transactionCount
              : 0,
          totalCostUSD: data.totalCostUSD,
        }))
        .sort((a, b) => a.hour - b.hour);

      return {
        merchantId,
        transactionStats: {
          totalTransactions: transactions.length,
          successfulTransactions,
          failedTransactions: transactions.length - successfulTransactions,
          successRate:
            transactions.length > 0
              ? (successfulTransactions / transactions.length) * 100
              : 0,
          avgGasUsed:
            transactions.length > 0 ? totalGasUsed / transactions.length : 0,
          totalGasUsed,
          avgGasPrice:
            transactions.length > 0 ? totalGasPrice / transactions.length : 0,
          totalCostUSD,
        },
        chainBreakdown,
        gasPriceVolatility,
        timeBasedPatterns,
      };
    } catch (error) {
      this.logger.error(
        `Failed to analyze transactions for merchant ${merchantId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get transaction analysis for a specific time range
   */
  async getTransactionAnalysis(
    merchantId: string,
    daysBack: number = 30,
  ): Promise<any> {
    const endDate = new Date();
    const startDate = new Date(
      endDate.getTime() - daysBack * 24 * 60 * 60 * 1000,
    );

    return this.analyzeMerchantTransactions(merchantId, startDate, endDate);
  }

  /**
   * Compare chain costs for a merchant
   */
  async compareChainCosts(
    merchantId: string,
    daysBack: number = 30,
  ): Promise<
    Array<{
      chainId: string;
      chainName: string;
      avgGasUsed: number;
      avgCostPerTransaction: number;
      transactionCount: number;
      successRate: number;
    }>
  > {
    const analysis = await this.getTransactionAnalysis(merchantId, daysBack);
    return analysis.chainBreakdown.map((chain) => ({
      chainId: chain.chainId,
      chainName: chain.chainName,
      avgGasUsed: chain.avgGasUsed,
      avgCostPerTransaction:
        chain.transactionCount > 0
          ? chain.totalCostUSD / chain.transactionCount
          : 0,
      transactionCount: chain.transactionCount,
      successRate: chain.successRate,
    }));
  }
}
