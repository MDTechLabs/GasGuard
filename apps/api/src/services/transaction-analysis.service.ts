import { Injectable } from "@nestjs/common";
import { FailedTransactionService } from "./failed-transaction.service";
import { MitigationService } from "./mitigation.service";
import {
  TransactionAnalysisRequest,
  TransactionAnalysisResponse,
  FailureAnalysis,
  ChainFailureStats,
  FailedTransaction,
  FailureCategory,
} from "../schemas/failed-transaction.schema";

@Injectable()
export class TransactionAnalysisService {
  constructor(
    private readonly failedTransactionService: FailedTransactionService,
    private readonly mitigationService: MitigationService,
  ) {}

  /**
   * Analyze failed transactions for a wallet
   */
  async analyzeWalletFailures(
    request: TransactionAnalysisRequest,
  ): Promise<TransactionAnalysisResponse> {
    const {
      wallet,
      chainIds,
      timeframe,
      includeRecommendations = true,
    } = request;

    // Get failed transactions
    const failures = await this.failedTransactionService.getWalletFailures(
      wallet,
      chainIds,
    );

    // Filter by timeframe if specified
    const filteredFailures = this.filterByTimeframe(failures, timeframe);

    // Calculate cost metrics
    const costMetrics =
      await this.failedTransactionService.calculateCostMetrics(
        wallet,
        chainIds,
      );

    // Analyze failure categories
    const failureCategories = this.categorizeFailures(filteredFailures);

    // Calculate chain breakdown
    const chainBreakdown = this.calculateChainBreakdown(filteredFailures);

    // Generate recommendations
    const recommendations = includeRecommendations
      ? await this.mitigationService.generateRecommendations({
          wallet,
          totalFailures: filteredFailures.length,
          totalGasWasted: costMetrics.totalGasWasted,
          totalGasWastedUSD: costMetrics.totalGasWastedUSD,
          failureCategories,
          topFailureCategory: this.getTopFailureCategory(failureCategories),
          recommendations: [], // Will be populated
          timeframe: {
            start:
              timeframe?.start || this.getDefaultStartDate(filteredFailures),
            end: timeframe?.end || new Date().toISOString(),
          },
          chainBreakdown,
        })
      : [];

    const analysis: FailureAnalysis = {
      wallet,
      totalFailures: filteredFailures.length,
      totalGasWasted: costMetrics.totalGasWasted,
      totalGasWastedUSD: costMetrics.totalGasWastedUSD,
      failureCategories,
      topFailureCategory: this.getTopFailureCategory(failureCategories),
      recommendations,
      timeframe: {
        start: timeframe?.start || this.getDefaultStartDate(filteredFailures),
        end: timeframe?.end || new Date().toISOString(),
      },
      chainBreakdown,
    };

    return {
      wallet,
      analysis,
      processedAt: new Date().toISOString(),
      requestId: this.generateRequestId(),
    };
  }

  /**
   * Get immediate mitigation for a recent failure
   */
  async getImmediateMitigation(
    wallet: string,
    transactionHash?: string,
  ): Promise<any> {
    const failures =
      await this.failedTransactionService.getWalletFailures(wallet);

    // Get the most recent failure or specific transaction
    const targetFailure = transactionHash
      ? failures.find((f) => f.hash === transactionHash)
      : failures.sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        )[0];

    if (!targetFailure) {
      throw new Error("No failed transaction found");
    }

    const recommendations =
      await this.mitigationService.getImmediateMitigation(targetFailure);

    return {
      transaction: targetFailure,
      recommendations,
      processedAt: new Date().toISOString(),
    };
  }

  /**
   * Get wallet statistics summary
   */
  async getWalletSummary(wallet: string, chainIds?: number[]): Promise<any> {
    const failures = await this.failedTransactionService.getWalletFailures(
      wallet,
      chainIds,
    );
    const costMetrics =
      await this.failedTransactionService.calculateCostMetrics(
        wallet,
        chainIds,
      );

    const last30Days = failures.filter(
      (f) =>
        new Date(f.timestamp) >=
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    );

    const last7Days = failures.filter(
      (f) =>
        new Date(f.timestamp) >= new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    );

    return {
      wallet,
      summary: {
        totalFailures: failures.length,
        totalGasWasted: costMetrics.totalGasWasted,
        totalGasWastedUSD: costMetrics.totalGasWastedUSD,
        last30DaysFailures: last30Days.length,
        last7DaysFailures: last7Days.length,
        averageFailuresPerDay: (last30Days.length / 30).toFixed(2),
        mostActiveChain: this.getMostActiveChain(failures),
        topFailureCategory: this.getTopFailureCategory(
          this.categorizeFailures(failures),
        ),
      },
      processedAt: new Date().toISOString(),
    };
  }

  /**
   * Process a failed transaction event
   */
  async processFailedTransaction(
    transactionData: Partial<FailedTransaction>,
  ): Promise<FailedTransaction> {
    return await this.failedTransactionService.trackFailedTransaction(
      transactionData,
    );
  }

  /**
   * Helper methods
   */
  private filterByTimeframe(
    failures: FailedTransaction[],
    timeframe?: { start?: string; end?: string },
  ): FailedTransaction[] {
    if (!timeframe) return failures;

    return failures.filter((tx) => {
      const txDate = new Date(tx.timestamp);
      const startDate = timeframe.start
        ? new Date(timeframe.start)
        : new Date(0);
      const endDate = timeframe.end ? new Date(timeframe.end) : new Date();

      return txDate >= startDate && txDate <= endDate;
    });
  }

  private categorizeFailures(
    failures: FailedTransaction[],
  ): Record<string, number> {
    const categories: Record<string, number> = {};

    failures.forEach((tx) => {
      categories[tx.failureCategory] =
        (categories[tx.failureCategory] || 0) + 1;
    });

    return categories;
  }

  private calculateChainBreakdown(
    failures: FailedTransaction[],
  ): Record<number, ChainFailureStats> {
    const chainStats: Record<number, ChainFailureStats> = {};

    failures.forEach((tx) => {
      if (!chainStats[tx.chainId]) {
        chainStats[tx.chainId] = {
          chainId: tx.chainId,
          failures: 0,
          gasWasted: "0",
          mostCommonCategory: "unknown",
        };
      }

      const stats = chainStats[tx.chainId];
      stats.failures += 1;
      stats.gasWasted = (
        BigInt(stats.gasWasted) + BigInt(tx.effectiveFee)
      ).toString();
    });

    // Calculate most common category for each chain
    Object.keys(chainStats).forEach((chainId) => {
      const chainFailures = failures.filter(
        (tx) => tx.chainId === parseInt(chainId),
      );
      const categories = this.categorizeFailures(chainFailures);
      chainStats[parseInt(chainId)].mostCommonCategory =
        this.getTopFailureCategory(categories);
    });

    return chainStats;
  }

  private getTopFailureCategory(
    categories: Record<string, number>,
  ): FailureCategory {
    let maxCount = 0;
    let topCategory: FailureCategory = "unknown";

    Object.entries(categories).forEach(([category, count]) => {
      if (count > maxCount) {
        maxCount = count;
        topCategory = category as FailureCategory;
      }
    });

    return topCategory;
  }

  private getMostActiveChain(failures: FailedTransaction[]): number {
    const chainCounts: Record<number, number> = {};

    failures.forEach((tx) => {
      chainCounts[tx.chainId] = (chainCounts[tx.chainId] || 0) + 1;
    });

    let maxCount = 0;
    let topChain = 1;

    Object.entries(chainCounts).forEach(([chainId, count]) => {
      if (count > maxCount) {
        maxCount = count;
        topChain = parseInt(chainId);
      }
    });

    return topChain;
  }

  private getDefaultStartDate(failures: FailedTransaction[]): string {
    if (failures.length === 0) {
      return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days ago
    }

    const oldestTx = failures.reduce((oldest, current) =>
      new Date(current.timestamp) < new Date(oldest.timestamp)
        ? current
        : oldest,
    );

    return oldestTx.timestamp;
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
