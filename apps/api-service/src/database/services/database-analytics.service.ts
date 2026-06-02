import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { TransactionRepository } from "../repositories/transaction.repository";
import { MerchantRepository } from "../repositories/merchant.repository";
import { ChainRepository } from "../repositories/chain.repository";
import { AnalysisResultRepository } from "../repositories/analysis-result.repository";

@Injectable()
export class DatabaseAnalyticsService {
  private readonly logger = new Logger(DatabaseAnalyticsService.name);

  constructor(
    @InjectRepository(TransactionRepository)
    private readonly transactionRepository: TransactionRepository,
    @InjectRepository(MerchantRepository)
    private readonly merchantRepository: MerchantRepository,
    @InjectRepository(ChainRepository)
    private readonly chainRepository: ChainRepository,
    @InjectRepository(AnalysisResultRepository)
    private readonly analysisResultRepository: AnalysisResultRepository,
  ) {}

  /**
   * Get comprehensive dashboard analytics
   */
  async getDashboardAnalytics(
    timeRange: "24h" | "7d" | "30d" = "7d",
  ): Promise<any> {
    const endDate = new Date();
    const startDate = this.getDateFromTimeRange(timeRange, endDate);

    try {
      const [
        transactionMetrics,
        merchantAnalytics,
        chainMetrics,
        analysisSummary,
      ] = await Promise.all([
        this.transactionRepository.getTransactionSuccessMetrics(
          undefined,
          undefined,
          startDate,
          endDate,
        ),
        this.merchantRepository.getMerchantAnalytics(startDate, endDate),
        this.chainRepository.getChainReliabilityMetrics(startDate, endDate),
        this.analysisResultRepository.getAnalysisSummary(
          undefined,
          undefined,
          startDate,
          endDate,
        ),
      ]);

      return {
        timeRange,
        period: {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
        transactionMetrics,
        topMerchants: merchantAnalytics.slice(0, 10),
        chainMetrics: chainMetrics.slice(0, 10),
        analysisSummary,
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to get dashboard analytics", error);
      throw error;
    }
  }

  /**
   * Get merchant-specific analytics
   */
  async getMerchantAnalytics(
    merchantId: string,
    timeRange: "24h" | "7d" | "30d" = "7d",
  ): Promise<any> {
    const endDate = new Date();
    const startDate = this.getDateFromTimeRange(timeRange, endDate);

    try {
      const [
        gasUsage,
        transactionMetrics,
        analysisSummary,
        highGasTransactions,
      ] = await Promise.all([
        this.transactionRepository.getGasUsageByMerchant(
          merchantId,
          startDate,
          endDate,
        ),
        this.transactionRepository.getTransactionSuccessMetrics(
          merchantId,
          undefined,
          startDate,
          endDate,
        ),
        this.analysisResultRepository.getAnalysisSummary(
          merchantId,
          undefined,
          startDate,
          endDate,
        ),
        this.transactionRepository.getHighGasTransactions(10),
      ]);

      return {
        merchantId,
        timeRange,
        period: {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
        gasUsageTrend: gasUsage,
        transactionMetrics,
        analysisSummary,
        highGasTransactions,
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(
        `Failed to get merchant analytics for ${merchantId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get chain-specific analytics
   */
  async getChainAnalytics(
    chainId: string,
    timeRange: "24h" | "7d" | "30d" = "7d",
  ): Promise<any> {
    const endDate = new Date();
    const startDate = this.getDateFromTimeRange(timeRange, endDate);

    try {
      const [
        transactionVolume,
        reliabilityMetrics,
        gasVolatility,
        failedAnalysis,
      ] = await Promise.all([
        this.transactionRepository.getTransactionVolumeByChain(
          startDate,
          endDate,
        ),
        this.chainRepository.getChainReliabilityMetrics(startDate, endDate),
        this.chainRepository.getGasVolatilityMetrics(30),
        this.transactionRepository.getFailedTransactionAnalysis(
          startDate,
          endDate,
        ),
      ]);

      const chainData = transactionVolume.find((t) => t.chainId === chainId);
      const reliabilityData = reliabilityMetrics.find(
        (c) => c.chainId === chainId,
      );
      const volatilityData = gasVolatility.find((c) => c.chainId === chainId);

      return {
        chainId,
        timeRange,
        period: {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
        transactionMetrics: chainData,
        reliabilityMetrics: reliabilityData,
        gasVolatility: volatilityData,
        failedTransactionAnalysis: failedAnalysis.filter(
          (f) => f.chainId === chainId,
        ),
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Failed to get chain analytics for ${chainId}`, error);
      throw error;
    }
  }

  /**
   * Get analysis performance metrics
   */
  async getAnalysisMetrics(
    timeRange: "24h" | "7d" | "30d" = "7d",
  ): Promise<any> {
    const endDate = new Date();
    const startDate = this.getDateFromTimeRange(timeRange, endDate);

    try {
      const [analysisSummary, topViolations, languageDistribution, trendData] =
        await Promise.all([
          this.analysisResultRepository.getAnalysisSummary(
            undefined,
            undefined,
            startDate,
            endDate,
          ),
          this.analysisResultRepository.getTopRuleViolations(
            10,
            startDate,
            endDate,
          ),
          this.analysisResultRepository.getLanguageDistribution(
            startDate,
            endDate,
          ),
          this.analysisResultRepository.getAnalysisTrend(30),
        ]);

      return {
        timeRange,
        period: {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
        summary: analysisSummary,
        topRuleViolations: topViolations,
        languageDistribution,
        trendData,
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to get analysis metrics", error);
      throw error;
    }
  }

  /**
   * Get performance monitoring data
   */
  async getPerformanceMetrics(): Promise<any> {
    try {
      // Get recent high-impact data for monitoring
      const [highGasTransactions, activeMerchants, chainPerformance] =
        await Promise.all([
          this.transactionRepository.getHighGasTransactions(20),
          this.merchantRepository.getActiveMerchants(7),
          this.chainRepository.getChainPerformanceRanking(),
        ]);

      return {
        monitoring: {
          highGasTransactions: highGasTransactions.length,
          activeMerchants: activeMerchants.length,
          totalChains: chainPerformance.length,
        },
        performanceIndicators: {
          avgChainReliability:
            chainPerformance.reduce((sum, c) => sum + c.reliabilityScore, 0) /
            chainPerformance.length,
          topPerformingChain: chainPerformance[0]?.chainName,
          lowestReliabilityChain:
            chainPerformance[chainPerformance.length - 1]?.chainName,
        },
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to get performance metrics", error);
      throw error;
    }
  }

  /**
   * Helper method to calculate date based on time range
   */
  private getDateFromTimeRange(
    timeRange: "24h" | "7d" | "30d",
    endDate: Date,
  ): Date {
    const startDate = new Date(endDate);
    switch (timeRange) {
      case "24h":
        startDate.setHours(startDate.getHours() - 24);
        break;
      case "7d":
        startDate.setDate(startDate.getDate() - 7);
        break;
      case "30d":
        startDate.setDate(startDate.getDate() - 30);
        break;
    }
    return startDate;
  }
}
