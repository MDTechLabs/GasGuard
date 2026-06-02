import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, Between, MoreThanOrEqual, LessThanOrEqual } from "typeorm";
import { Transaction } from "../../database/entities/transaction.entity";
import { Merchant } from "../../database/entities/merchant.entity";
import { Chain } from "../../database/entities/chain.entity";

@Injectable()
export class DataAggregationService {
  private readonly logger = new Logger(DataAggregationService.name);

  constructor(
    @InjectRepository(Transaction)
    private transactionRepository: Repository<Transaction>,
    @InjectRepository(Merchant)
    private merchantRepository: Repository<Merchant>,
    @InjectRepository(Chain)
    private chainRepository: Repository<Chain>,
  ) {}

  /**
   * Aggregate gas usage data for a specific merchant and time period
   */
  async aggregateGasUsageData(
    merchantId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<{
    merchantDetails: Partial<Merchant>;
    totalGasConsumed: number;
    totalGasCostUsd: number;
    chainBreakdown: Array<{
      chainId: string;
      chainName: string;
      totalGas: number;
      totalCostUsd: number;
      transactionCount: number;
      successRate: number;
    }>;
    transactionCount: number;
    successMetrics: {
      successfulTransactions: number;
      failedTransactions: number;
      successRate: number;
    };
  }> {
    try {
      // Get merchant details
      const merchant = await this.merchantRepository.findOne({
        where: { id: merchantId },
      });

      // Get all transactions for the merchant in the specified period
      const transactions = await this.transactionRepository.find({
        where: {
          merchantId,
          createdAt: Between(startDate, endDate),
        },
      });

      // Calculate total gas consumed and cost
      let totalGasConsumed = 0;
      let totalGasCostUsd = 0;
      let successfulTransactions = 0;
      let failedTransactions = 0;

      // Group transactions by chain
      const chainMap = new Map<
        string,
        {
          totalGas: number;
          totalCostUsd: number;
          transactionCount: number;
          successfulTransactions: number;
        }
      >();

      for (const transaction of transactions) {
        totalGasConsumed += Number(transaction.gasUsed || 0);
        totalGasCostUsd += Number(transaction.transactionFee || 0);

        if (transaction.status === "success") {
          successfulTransactions++;
        } else {
          failedTransactions++;
        }

        // Update chain breakdown
        if (!chainMap.has(transaction.chainId)) {
          chainMap.set(transaction.chainId, {
            totalGas: 0,
            totalCostUsd: 0,
            transactionCount: 0,
            successfulTransactions: 0,
          });
        }

        const chainData = chainMap.get(transaction.chainId)!;
        chainData.totalGas += Number(transaction.gasUsed || 0);
        chainData.totalCostUsd += Number(transaction.transactionFee || 0);
        chainData.transactionCount++;
        if (transaction.status === "success") {
          chainData.successfulTransactions++;
        }
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
          totalGas: data.totalGas,
          totalCostUsd: data.totalCostUsd,
          transactionCount: data.transactionCount,
          successRate:
            data.transactionCount > 0
              ? (data.successfulTransactions / data.transactionCount) * 100
              : 0,
        }),
      );

      return {
        merchantDetails: {
          id: merchant?.id,
          name: merchant?.name,
          email: merchant?.email,
        },
        totalGasConsumed,
        totalGasCostUsd,
        chainBreakdown,
        transactionCount: transactions.length,
        successMetrics: {
          successfulTransactions,
          failedTransactions,
          successRate:
            transactions.length > 0
              ? (successfulTransactions / transactions.length) * 100
              : 0,
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to aggregate gas usage data for merchant ${merchantId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get weekly gas usage data for a merchant
   */
  async getWeeklyGasUsage(merchantId: string): Promise<any> {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago

    return this.aggregateGasUsageData(merchantId, startDate, endDate);
  }

  /**
   * Get monthly gas usage data for a merchant
   */
  async getMonthlyGasUsage(merchantId: string): Promise<any> {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

    return this.aggregateGasUsageData(merchantId, startDate, endDate);
  }

  /**
   * Identify abnormal usage patterns
   */
  async detectAbnormalUsage(
    merchantId: string,
    period: "weekly" | "monthly",
  ): Promise<any[]> {
    // Get current period data
    const currentData =
      period === "weekly"
        ? await this.getWeeklyGasUsage(merchantId)
        : await this.getMonthlyGasUsage(merchantId);

    // Compare with previous period data to detect anomalies
    // This is a simplified version - in practice, you'd want more sophisticated anomaly detection
    const previousStartDate = new Date(currentData.startDate);
    const previousEndDate = new Date(currentData.endDate);

    if (period === "weekly") {
      previousStartDate.setDate(previousStartDate.getDate() - 7);
      previousEndDate.setDate(previousEndDate.getDate() - 7);
    } else {
      // Approximate previous month (30 days)
      previousStartDate.setDate(previousStartDate.getDate() - 30);
      previousEndDate.setDate(previousEndDate.getDate() - 30);
    }

    const previousData = await this.aggregateGasUsageData(
      merchantId,
      previousStartDate,
      previousEndDate,
    );

    const anomalies = [];

    // Check for significant increases in gas consumption
    if (currentData.totalGasConsumed > previousData.totalGasConsumed * 1.5) {
      anomalies.push({
        type: "HIGH_GAS_CONSUMPTION",
        message: `Gas consumption increased by ${((currentData.totalGasConsumed / previousData.totalGasConsumed) * 100 - 100).toFixed(2)}% compared to previous ${period}`,
        currentValue: currentData.totalGasConsumed,
        previousValue: previousData.totalGasConsumed,
      });
    }

    // Check for significant changes in success rate
    const currentSuccessRate = currentData.successMetrics.successRate;
    const previousSuccessRate = previousData.successMetrics.successRate;
    const rateDifference = Math.abs(currentSuccessRate - previousSuccessRate);

    if (rateDifference > 10) {
      // More than 10% difference
      anomalies.push({
        type: "SUCCESS_RATE_CHANGE",
        message: `Transaction success rate changed by ${rateDifference.toFixed(2)}% compared to previous ${period}`,
        currentValue: currentSuccessRate,
        previousValue: previousSuccessRate,
      });
    }

    return anomalies;
  }
}
