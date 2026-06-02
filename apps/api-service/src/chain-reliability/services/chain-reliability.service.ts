import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  ChainPerformanceMetric,
  MetricTimeWindow,
} from "../entities/chain-performance-metric.entity";
import { Chain } from "../../database/entities/chain.entity";
import { Transaction } from "../../database/entities/transaction.entity";
import {
  LeaderboardEntry,
  LeaderboardQuery,
  ReliabilityScores,
  ChainPerformanceData,
  MetricsCollectionOptions,
} from "../interfaces/chain-reliability.interface";

@Injectable()
export class ChainReliabilityService {
  private readonly logger = new Logger(ChainReliabilityService.name);

  // Weight constants for reliability score calculation
  private readonly STABILITY_WEIGHT = 0.6;
  private readonly COST_EFFICIENCY_WEIGHT = 0.4;

  constructor(
    @InjectRepository(ChainPerformanceMetric)
    private readonly metricRepository: Repository<ChainPerformanceMetric>,
    @InjectRepository(Chain)
    private readonly chainRepository: Repository<Chain>,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
  ) {}

  /**
   * Calculate reliability scores for a chain based on collected metrics
   */
  calculateReliabilityScores(
    successRate: number,
    averageLatency: number,
    averageGasPrice: number,
    gasPriceVolatility: number,
  ): ReliabilityScores {
    // Calculate stability score (60% success rate, 40% latency)
    const latencyScore = this.calculateLatencyScore(averageLatency);
    const stabilityScore = successRate * 0.6 + latencyScore * 0.4;

    // Calculate cost efficiency score (based on gas price and volatility)
    const costEfficiencyScore = this.calculateCostEfficiencyScore(
      averageGasPrice,
      gasPriceVolatility,
    );

    // Calculate overall reliability score
    const overallReliabilityScore =
      stabilityScore * this.STABILITY_WEIGHT +
      costEfficiencyScore * this.COST_EFFICIENCY_WEIGHT;

    return {
      stabilityScore: Math.round(stabilityScore * 100) / 100,
      costEfficiencyScore: Math.round(costEfficiencyScore * 100) / 100,
      overallReliabilityScore: Math.round(overallReliabilityScore * 100) / 100,
    };
  }

  /**
   * Calculate latency score (0-100) - lower latency is better
   */
  private calculateLatencyScore(latency: number): number {
    if (latency <= 0) return 100;
    if (latency >= 10000) return 0; // 10 seconds = 0 score

    // Exponential decay: 0ms = 100, 1000ms = 60, 5000ms = 10, 10000ms = 0
    return Math.max(0, 100 * Math.exp(-latency / 3000));
  }

  /**
   * Calculate cost efficiency score (0-100) - lower gas price and volatility is better
   */
  private calculateCostEfficiencyScore(
    averageGasPrice: number,
    gasVolatility: number,
  ): number {
    // Normalize gas price (assuming range 0.001 - 1 ETH = 0 - 100 score)
    const gasPriceScore = Math.max(0, 100 - averageGasPrice * 100);

    // Volatility score (lower volatility is better)
    // Assuming volatility range 0 - 1
    const volatilityScore = Math.max(0, 100 - gasVolatility * 100);

    return gasPriceScore * 0.6 + volatilityScore * 0.4;
  }

  /**
   * Collect metrics for a specific chain and time window
   */
  async collectMetrics(
    chainId: string,
    timeWindow: MetricTimeWindow,
  ): Promise<ChainPerformanceData> {
    const chain = await this.chainRepository.findOne({ where: { chainId } });
    if (!chain) {
      throw new Error(`Chain with id ${chainId} not found`);
    }

    const { startDate, endDate } = this.getDateRangeForTimeWindow(timeWindow);

    // Get transaction metrics
    const transactionMetrics = await this.getTransactionMetrics(
      chainId,
      startDate,
      endDate,
    );

    // Get gas metrics
    const gasMetrics = await this.getGasMetrics(chainId, startDate, endDate);

    // For network metrics, we would need external monitoring
    // Using placeholder values for now
    const networkMetrics = {
      averageLatency: 500, // Placeholder - would come from network monitoring
      latencyVolatility: 0.2,
      networkCongestionScore: 50,
    };

    // Calculate reliability scores
    const reliabilityScores = this.calculateReliabilityScores(
      transactionMetrics.successRate,
      networkMetrics.averageLatency,
      gasMetrics.averageGasPrice || 0,
      gasMetrics.gasPriceVolatility || 0,
    );

    // Save the metric
    const metric = this.metricRepository.create({
      chainId,
      timeWindow,
      recordedAt: endDate,
      transactionSuccessRate: transactionMetrics.successRate,
      totalTransactions: transactionMetrics.totalTransactions,
      successfulTransactions: transactionMetrics.successfulTransactions,
      failedTransactions: transactionMetrics.failedTransactions,
      averageGasPrice: gasMetrics.averageGasPrice,
      minGasPrice: gasMetrics.minGasPrice,
      maxGasPrice: gasMetrics.maxGasPrice,
      gasPriceVolatility: gasMetrics.gasPriceVolatility,
      averageTransactionFee: gasMetrics.averageTransactionFee,
      averageLatency: networkMetrics.averageLatency,
      latencyVolatility: networkMetrics.latencyVolatility,
      networkCongestionScore: networkMetrics.networkCongestionScore,
      stabilityScore: reliabilityScores.stabilityScore,
      costEfficiencyScore: reliabilityScores.costEfficiencyScore,
      overallReliabilityScore: reliabilityScores.overallReliabilityScore,
    });

    await this.metricRepository.save(metric);

    // Also update the chain's reliability score
    await this.chainRepository.update(chainId, {
      reliabilityScore: reliabilityScores.overallReliabilityScore,
      averageGasPrice: gasMetrics.averageGasPrice,
      gasVolatility: gasMetrics.gasPriceVolatility,
    });

    return {
      chainId,
      chainName: chain.name,
      network: chain.network,
      transactionMetrics,
      gasMetrics,
      networkMetrics,
      reliabilityScores,
      recordedAt: endDate,
    };
  }

  /**
   * Get transaction metrics for a chain within a date range
   */
  private async getTransactionMetrics(
    chainId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<{
    totalTransactions: number;
    successfulTransactions: number;
    failedTransactions: number;
    successRate: number;
  }> {
    const result = await this.transactionRepository
      .createQueryBuilder("transaction")
      .select("COUNT(transaction.id)", "totalTransactions")
      .addSelect(
        "COUNT(CASE WHEN transaction.status = 'success' THEN 1 END)",
        "successfulTransactions",
      )
      .addSelect(
        "COUNT(CASE WHEN transaction.status = 'failed' THEN 1 END)",
        "failedTransactions",
      )
      .where("transaction.chainId = :chainId", { chainId })
      .andWhere("transaction.createdAt BETWEEN :startDate AND :endDate", {
        startDate,
        endDate,
      })
      .getRawOne();

    const totalTransactions = parseInt(result.totalTransactions) || 0;
    const successfulTransactions = parseInt(result.successfulTransactions) || 0;
    const failedTransactions = parseInt(result.failedTransactions) || 0;
    const successRate =
      totalTransactions > 0
        ? (successfulTransactions / totalTransactions) * 100
        : 0;

    return {
      totalTransactions,
      successfulTransactions,
      failedTransactions,
      successRate: Math.round(successRate * 100) / 100,
    };
  }

  /**
   * Get gas metrics for a chain within a date range
   */
  private async getGasMetrics(
    chainId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<{
    averageGasPrice: number;
    minGasPrice: number;
    maxGasPrice: number;
    gasPriceVolatility: number;
    averageTransactionFee: number;
  }> {
    const result = await this.transactionRepository
      .createQueryBuilder("transaction")
      .select("AVG(transaction.gasPrice)", "avgGasPrice")
      .addSelect("MIN(transaction.gasPrice)", "minGasPrice")
      .addSelect("MAX(transaction.gasPrice)", "maxGasPrice")
      .addSelect("AVG(transaction.transactionFee)", "avgTransactionFee")
      .addSelect("STDDEV(transaction.gasPrice)", "gasPriceStdDev")
      .where("transaction.chainId = :chainId", { chainId })
      .andWhere("transaction.createdAt BETWEEN :startDate AND :endDate", {
        startDate,
        endDate,
      })
      .andWhere("transaction.status = 'success'")
      .getRawOne();

    const avgGasPrice = parseFloat(result.avgGasPrice) || 0;
    const stdDev = parseFloat(result.gasPriceStdDev) || 0;
    const avgFee = parseFloat(result.avgTransactionFee) || 0;

    // Calculate coefficient of variation as volatility measure
    const volatility = avgGasPrice > 0 ? stdDev / avgGasPrice : 0;

    return {
      averageGasPrice: avgGasPrice,
      minGasPrice: parseFloat(result.minGasPrice) || 0,
      maxGasPrice: parseFloat(result.maxGasPrice) || 0,
      gasPriceVolatility: Math.round(volatility * 100) / 100,
      averageTransactionFee: avgFee,
    };
  }

  /**
   * Get date range for a given time window
   */
  private getDateRangeForTimeWindow(timeWindow: MetricTimeWindow): {
    startDate: Date;
    endDate: Date;
  } {
    const endDate = new Date();
    const startDate = new Date();

    switch (timeWindow) {
      case MetricTimeWindow.DAILY:
        startDate.setDate(startDate.getDate() - 1);
        break;
      case MetricTimeWindow.WEEKLY:
        startDate.setDate(startDate.getDate() - 7);
        break;
      case MetricTimeWindow.MONTHLY:
        startDate.setMonth(startDate.getMonth() - 1);
        break;
    }

    return { startDate, endDate };
  }

  /**
   * Get the leaderboard for chains
   */
  async getLeaderboard(query: LeaderboardQuery): Promise<LeaderboardEntry[]> {
    const { timeWindow, limit = 10 } = query;

    // Get latest metrics for all chains
    const metrics = await this.getLatestMetricsForAllChains(timeWindow);

    // Get chain details
    const chains = await this.chainRepository.find();

    // Combine and create leaderboard entries
    const leaderboard: LeaderboardEntry[] = [];
    let rank = 1;

    for (const metric of metrics) {
      const chain = chains.find((c) => c.chainId === metric.chainId);
      if (!chain) continue;

      leaderboard.push({
        rank: rank++,
        chainId: metric.chainId,
        chainName: chain.name,
        network: chain.network,
        reliabilityScore: Number(metric.overallReliabilityScore) || 0,
        stabilityScore: Number(metric.stabilityScore) || 0,
        costEfficiencyScore: Number(metric.costEfficiencyScore) || 0,
        successRate: Number(metric.transactionSuccessRate) || 0,
        averageGasPrice: Number(metric.averageGasPrice) || 0,
        networkCongestionScore: Number(metric.networkCongestionScore) || 0,
      });
    }

    return leaderboard.slice(0, limit);
  }

  /**
   * Get latest metrics for all chains
   */
  private async getLatestMetricsForAllChains(
    timeWindow: MetricTimeWindow,
  ): Promise<ChainPerformanceMetric[]> {
    const chains = await this.chainRepository.find();
    const latestMetrics: ChainPerformanceMetric[] = [];

    for (const chain of chains) {
      const metric = await this.metricRepository.findOne({
        where: { chainId: chain.chainId, timeWindow },
        order: { recordedAt: "DESC" },
      });

      if (metric) {
        latestMetrics.push(metric);
      }
    }

    return latestMetrics.sort(
      (a, b) =>
        Number(b.overallReliabilityScore) - Number(a.overallReliabilityScore),
    );
  }

  /**
   * Get chain performance history
   */
  async getChainPerformanceHistory(
    chainId: string,
    timeWindow: MetricTimeWindow,
    limit: number = 30,
  ): Promise<ChainPerformanceMetric[]> {
    return this.metricRepository.find({
      where: { chainId, timeWindow },
      order: { recordedAt: "DESC" },
      take: limit,
    });
  }

  /**
   * Trigger metrics collection for all active chains
   */
  async collectAllChainMetrics(timeWindow: MetricTimeWindow): Promise<void> {
    const chains = await this.chainRepository.find({
      where: { status: "active" },
    });

    for (const chain of chains) {
      try {
        await this.collectMetrics(chain.chainId, timeWindow);
        this.logger.log(`Collected metrics for chain ${chain.chainId}`);
      } catch (error) {
        this.logger.error(
          `Failed to collect metrics for chain ${chain.chainId}: ${error.message}`,
        );
      }
    }
  }
}
