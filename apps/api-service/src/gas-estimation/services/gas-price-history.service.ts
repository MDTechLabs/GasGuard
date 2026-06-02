import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { GasPriceHistory as GasPriceHistoryEntity } from "../entities/gas-price-history.entity";
import {
  GasPriceSnapshot,
  GasPriceHistory,
} from "../interfaces/gas-price.interface";
import { NetworkMonitorService } from "./network-monitor.service";

/**
 * GasPriceHistoryService
 * Manages historical gas price data and trend analysis
 */
@Injectable()
export class GasPriceHistoryService {
  private readonly logger = new Logger(GasPriceHistoryService.name);

  constructor(
    @InjectRepository(GasPriceHistoryEntity)
    private gasPriceHistoryRepository: Repository<GasPriceHistoryEntity>,
    private networkMonitor: NetworkMonitorService,
  ) {}

  /**
   * Record current gas price snapshot to history
   */
  async recordPriceSnapshot(
    snapshot: GasPriceSnapshot,
  ): Promise<GasPriceHistoryEntity> {
    const history = this.gasPriceHistoryRepository.create({
      chainId: snapshot.chainId,
      chainName: snapshot.chainName,
      baseGasPrice: snapshot.baseFeePerInstruction,
      surgeMultiplier: snapshot.surgePriceMultiplier,
      effectiveGasPrice: snapshot.recommendedFeeRate,
      networkLoad: snapshot.networkLoad,
      memoryPoolSize: snapshot.memoryPoolSize,
      transactionCount: snapshot.transactionCount,
      blockTime: snapshot.averageBlockTime,
      volatilityIndex: snapshot.volatilityIndex,
      priceConfidence: snapshot.priceConfidence,
    });

    return await this.gasPriceHistoryRepository.save(history);
  }

  /**
   * Get historical gas prices for a chain
   */
  async getPriceHistory(
    chainId: string,
    hoursBack: number = 24,
  ): Promise<GasPriceHistory[]> {
    const startTime = new Date(Date.now() - hoursBack * 3600000);

    const records = await this.gasPriceHistoryRepository.find({
      where: {
        chainId,
        timestamp: { gte: startTime },
      },
      order: {
        timestamp: "ASC",
      },
    });

    return records.map((r) => ({
      timestamp: r.timestamp,
      basePrice: Number(r.baseGasPrice),
      surgeMultiplier: Number(r.surgeMultiplier),
      effectivePrice: Number(r.effectiveGasPrice),
      networkLoad: Number(r.networkLoad),
    }));
  }

  /**
   * Calculate average gas price over a period
   */
  async getAveragePriceOverPeriod(
    chainId: string,
    hoursBack: number = 24,
  ): Promise<{
    average: number;
    min: number;
    max: number;
    stdDev: number;
  }> {
    const history = await this.getPriceHistory(chainId, hoursBack);

    if (history.length === 0) {
      return { average: 0, min: 0, max: 0, stdDev: 0 };
    }

    const prices = history.map((h) => h.effectivePrice);
    const average = prices.reduce((a, b) => a + b) / prices.length;
    const min = Math.min(...prices);
    const max = Math.max(...prices);

    // Calculate standard deviation
    const variance =
      prices.reduce((sum, price) => sum + Math.pow(price - average, 2), 0) /
      prices.length;
    const stdDev = Math.sqrt(variance);

    return { average, min, max, stdDev };
  }

  /**
   * Detect if gas prices are trending up or down
   */
  async getPriceTrend(
    chainId: string,
    windowSizeHours: number = 6,
  ): Promise<{
    trend: "increasing" | "decreasing" | "stable";
    percentChange: number;
    confidence: number;
  }> {
    const history = await this.getPriceHistory(chainId, windowSizeHours * 2);

    if (history.length < 2) {
      return { trend: "stable", percentChange: 0, confidence: 0 };
    }

    const midpoint = Math.floor(history.length / 2);
    const firstHalf = history.slice(0, midpoint);
    const secondHalf = history.slice(midpoint);

    const firstAvg =
      firstHalf.reduce((sum, h) => sum + h.effectivePrice, 0) /
      firstHalf.length;
    const secondAvg =
      secondHalf.reduce((sum, h) => sum + h.effectivePrice, 0) /
      secondHalf.length;

    const percentChange = ((secondAvg - firstAvg) / firstAvg) * 100;
    const trend =
      percentChange > 2
        ? "increasing"
        : percentChange < -2
          ? "decreasing"
          : "stable";

    // Confidence based on consistency of trend
    const variance = this.calculateVariance(
      secondHalf.map((h) => h.effectivePrice),
    );
    const confidence = Math.max(0, 100 - variance * 2);

    return { trend, percentChange, confidence };
  }

  /**
   * Find optimal time windows for low gas prices (last 7 days)
   */
  async getBestTimeWindowsForLowPrices(
    chainId: string,
    topN: number = 5,
  ): Promise<
    Array<{
      hour: number;
      averagePrice: number;
      frequency: number;
    }>
  > {
    const history = await this.getPriceHistory(chainId, 168); // 7 days

    // Group by hour of day
    const hourlyStats = new Map<number, { sum: number; count: number }>();

    history.forEach((h) => {
      const hour = new Date(h.timestamp).getUTCHours();
      const current = hourlyStats.get(hour) || { sum: 0, count: 0 };
      current.sum += h.effectivePrice;
      current.count += 1;
      hourlyStats.set(hour, current);
    });

    const hourlyAverages = Array.from(hourlyStats.entries()).map(
      ([hour, stats]) => ({
        hour,
        averagePrice: stats.sum / stats.count,
        frequency: stats.count,
      }),
    );

    return hourlyAverages
      .sort((a, b) => a.averagePrice - b.averagePrice)
      .slice(0, topN);
  }

  /**
   * Calculate variance helper
   */
  private calculateVariance(prices: number[]): number {
    if (prices.length === 0) return 0;
    const average = prices.reduce((a, b) => a + b) / prices.length;
    const variance =
      prices.reduce((sum, price) => sum + Math.pow(price - average, 2), 0) /
      prices.length;
    return Math.sqrt(variance);
  }

  /**
   * Cleanup old records (keep last 30 days)
   */
  async cleanupOldRecords(olderThanDays: number = 30): Promise<void> {
    try {
      const cutoffDate = new Date(Date.now() - olderThanDays * 24 * 3600000);
      await this.gasPriceHistoryRepository.delete({
        timestamp: { lt: cutoffDate },
      });
      this.logger.log(
        `Cleaned up gas price history older than ${olderThanDays} days`,
      );
    } catch (error) {
      this.logger.error("Failed to cleanup old records", error);
    }
  }
}
