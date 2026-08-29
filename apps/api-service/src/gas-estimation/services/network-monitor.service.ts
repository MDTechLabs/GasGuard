import { Injectable, Logger } from "@nestjs/common";
import {
  NetworkMetrics,
  GasPriceSnapshot,
} from "../interfaces/gas-price.interface";
import { Cron, CronExpression } from "@nestjs/schedule";
import { NetworkConfigService } from "../config/network-config.service";

/**
 * NetworkMonitorService
 * Monitors real-time network conditions for Soroban
 * Tracks congestion, transaction volume, and network load
 */
@Injectable()
export class NetworkMonitorService {
  private readonly logger = new Logger(NetworkMonitorService.name);

  // In-memory cache for network metrics (would be replaced with actual RPC calls)
  private metricsCache: Map<string, NetworkMetrics> = new Map();
  private priceSnapshotCache: Map<string, GasPriceSnapshot> = new Map();

  constructor(private readonly networkConfigService: NetworkConfigService) {}

  /**
   * Get current network metrics for a chain
   */
  async getNetworkMetrics(chainId: string): Promise<NetworkMetrics> {
    // Check cache first
    if (this.metricsCache.has(chainId)) {
      return this.metricsCache.get(chainId)!;
    }

    // Fetch from Soroban RPC (mock implementation for demo)
    const metrics = await this.fetchNetworkMetricsFromRpc(chainId);
    this.metricsCache.set(chainId, metrics);

    return metrics;
  }

  /**
   * Get current gas price snapshot
   */
  async getGasPriceSnapshot(chainId: string): Promise<GasPriceSnapshot> {
    if (this.priceSnapshotCache.has(chainId)) {
      return this.priceSnapshotCache.get(chainId)!;
    }

    const snapshot = await this.createGasPriceSnapshot(chainId);
    this.priceSnapshotCache.set(chainId, snapshot);

    return snapshot;
  }

  /**
   * Update network metrics - called periodically
   */
  @Cron(CronExpression.EVERY_10_SECONDS)
  async updateNetworkMetrics(): Promise<void> {
    try {
      const chainIds = this.networkConfigService.getSupportedChainIds();

      for (const chainId of chainIds) {
        const metrics = await this.fetchNetworkMetricsFromRpc(chainId);
        this.metricsCache.set(chainId, metrics);

        // Update price snapshot
        const snapshot = await this.createGasPriceSnapshot(chainId);
        this.priceSnapshotCache.set(chainId, snapshot);
      }

      this.logger.debug("Network metrics updated successfully");
    } catch (error) {
      this.logger.error("Failed to update network metrics", error);
    }
  }

  /**
   * Fetch metrics from Soroban RPC endpoint
   */
  private async fetchNetworkMetricsFromRpc(
    chainId: string,
  ): Promise<NetworkMetrics> {
    // This would connect to actual Soroban RPC in production
    // For now, return mock data with some randomization to simulate network conditions
    const network = this.networkConfigService.getNetworkConfig(chainId);

    const baseLoad = network.baselineLoad;
    const randomFluctuation = Math.random() * 30 - 15; // -15 to +15
    const congestionLevel = Math.max(
      0,
      Math.min(100, baseLoad + randomFluctuation),
    );

    return {
      congestionLevel,
      gasPoolUtilization: congestionLevel * 0.8,
      averageTransactionTime: network.averageBlockTimeMs + Math.random() * 2000,
      pendingTransactionCount: Math.floor(congestionLevel * 10),
      lastBlockGasUsed:
        network.defaultBlockGasLimit * 0.75 +
        Math.floor(Math.random() * (network.defaultBlockGasLimit * 0.25)),
      lastBlockGasLimit: network.defaultBlockGasLimit,
      historicalAverageGasPrice: network.historicalAverageGasPrice,
      priceVolatility: congestionLevel * 0.5, // volatility increases with congestion
    };
  }

  /**
   * Create a gas price snapshot based on current metrics
   */
  private async createGasPriceSnapshot(
    chainId: string,
  ): Promise<GasPriceSnapshot> {
    const network = this.networkConfigService.getNetworkConfig(chainId);
    const metrics = await this.getNetworkMetrics(chainId);

    // Calculate surge multiplier based on congestion
    const surgeMultiplier = this.calculateSurgeMultiplier(
      metrics.congestionLevel,
    );

    // Base price (stroops per instruction) - Soroban default
    const basePrice = network.baseFeePerInstruction;
    const recommendedFeeRate = basePrice * surgeMultiplier;

    // Estimate price confidence (higher during stable, lower during volatile periods)
    const priceConfidence = Math.max(20, 100 - metrics.priceVolatility * 2);

    return {
      id: `snapshot-${chainId}-${Date.now()}`,
      chainId,
      chainName: network.chainName,
      timestamp: new Date(),
      baseFeePerInstruction: basePrice,
      surgePriceMultiplier: surgeMultiplier,
      recommendedFeeRate,
      networkLoad: metrics.congestionLevel,
      memoryPoolSize: metrics.gasPoolUtilization * 1e6, // simplified
      transactionCount: metrics.pendingTransactionCount,
      averageBlockTime: metrics.averageTransactionTime,
      volatilityIndex: metrics.priceVolatility,
      priceConfidence,
    };
  }

  /**
   * Calculate surge multiplier based on network congestion
   * Uses exponential scaling for dramatic price increases during high congestion
   */
  private calculateSurgeMultiplier(congestionLevel: number): number {
    if (congestionLevel < 30) {
      // Low congestion: base rate
      return 1.0;
    } else if (congestionLevel < 60) {
      // Medium congestion: linear increase
      return 1.0 + ((congestionLevel - 30) / 30) * 0.5; // 1.0 to 1.5
    } else if (congestionLevel < 85) {
      // High congestion: accelerated increase
      return 1.5 + ((congestionLevel - 60) / 25) * 1.0; // 1.5 to 2.5
    } else {
      // Critical congestion: exponential scaling
      const excessCongestion = congestionLevel - 85;
      return 2.5 * Math.pow(1.1, excessCongestion);
    }
  }

  /**
   * Get historical metrics (mock implementation)
   */
  async getHistoricalMetrics(
    chainId: string,
    hoursBack: number = 24,
  ): Promise<GasPriceSnapshot[]> {
    const network = this.networkConfigService.getNetworkConfig(chainId);
    // In production, query database for historical snapshots
    const snapshots: GasPriceSnapshot[] = [];
    const now = Date.now();

    for (let i = hoursBack; i > 0; i--) {
      const timestamp = new Date(now - i * 3600000);
      const congestionAtTime = Math.sin(i / 4) * 30 + 40; // Simulate patterns

      snapshots.push({
        id: `hist-${chainId}-${i}`,
        chainId,
        chainName: network.chainName,
        timestamp,
        baseFeePerInstruction: network.baseFeePerInstruction,
        surgePriceMultiplier: this.calculateSurgeMultiplier(congestionAtTime),
        recommendedFeeRate:
          network.baseFeePerInstruction *
          this.calculateSurgeMultiplier(congestionAtTime),
        networkLoad: congestionAtTime,
        memoryPoolSize: 0,
        transactionCount: Math.floor(congestionAtTime * 10),
        averageBlockTime: network.averageBlockTimeMs + Math.random() * 2000,
        volatilityIndex: congestionAtTime * 0.4,
        priceConfidence: Math.max(40, 100 - congestionAtTime),
      });
    }

    return snapshots;
  }
}
