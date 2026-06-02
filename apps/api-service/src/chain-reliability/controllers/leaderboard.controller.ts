import { Controller, Get, Query, Param } from "@nestjs/common";
import { ChainReliabilityService } from "../services/chain-reliability.service";
import { MetricTimeWindow } from "../entities/chain-performance-metric.entity";
import { LeaderboardEntry } from "../interfaces/chain-reliability.interface";

@Controller("api/v1/leaderboard")
export class LeaderboardController {
  constructor(
    private readonly chainReliabilityService: ChainReliabilityService,
  ) {}

  /**
   * GET /api/v1/leaderboard
   * Get the chain reliability leaderboard
   * Public endpoint for developers and merchants to view chain rankings
   *
   * Query params:
   * - timeWindow: Time window for metrics (daily, weekly, monthly) - default: daily
   * - limit: Maximum number of chains to return - default: 10
   *
   * @returns Ranked list of chains by reliability score
   */
  @Get()
  async getLeaderboard(
    @Query("timeWindow") timeWindow: string = "daily",
    @Query("limit") limit: string = "10",
  ): Promise<{
    success: boolean;
    data: LeaderboardEntry[];
    timeWindow: string;
    generatedAt: string;
  }> {
    const parsedTimeWindow =
      (timeWindow as MetricTimeWindow) || MetricTimeWindow.DAILY;
    const parsedLimit = parseInt(limit) || 10;

    const leaderboard = await this.chainReliabilityService.getLeaderboard({
      timeWindow: parsedTimeWindow,
      limit: parsedLimit,
    });

    return {
      success: true,
      data: leaderboard,
      timeWindow: parsedTimeWindow,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * GET /api/v1/leaderboard/chain/:chainId
   * Get detailed performance data for a specific chain
   *
   * @param chainId - The chain identifier
   * @param timeWindow - Time window for metrics (default: weekly)
   *
   * @returns Detailed performance metrics for the chain
   */
  @Get("chain/:chainId")
  async getChainPerformance(
    @Param("chainId") chainId: string,
    @Query("timeWindow") timeWindow: string = "weekly",
  ): Promise<{
    success: boolean;
    chainId: string;
    timeWindow: string;
    data: any;
    generatedAt: string;
  }> {
    const parsedTimeWindow =
      (timeWindow as MetricTimeWindow) || MetricTimeWindow.WEEKLY;

    const history =
      await this.chainReliabilityService.getChainPerformanceHistory(
        chainId,
        parsedTimeWindow,
      );

    return {
      success: true,
      chainId,
      timeWindow: parsedTimeWindow,
      data: history,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * GET /api/v1/leaderboard/compare
   * Get comparison data for multiple chains
   *
   * @param chains - Comma-separated chain IDs
   * @param timeWindow - Time window for metrics (default: weekly)
   *
   * @returns Comparison data for specified chains
   */
  @Get("compare")
  async compareChains(
    @Query("chains") chains: string,
    @Query("timeWindow") timeWindow: string = "weekly",
  ): Promise<{
    success: boolean;
    chains: string[];
    timeWindow: string;
    data: LeaderboardEntry[];
    generatedAt: string;
  }> {
    const chainIds = chains ? chains.split(",").map((c) => c.trim()) : [];
    const parsedTimeWindow =
      (timeWindow as MetricTimeWindow) || MetricTimeWindow.WEEKLY;

    const leaderboard = await this.chainReliabilityService.getLeaderboard({
      timeWindow: parsedTimeWindow,
      limit: chainIds.length || 10,
    });

    const filteredData =
      chainIds.length > 0
        ? leaderboard.filter((entry) => chainIds.includes(entry.chainId))
        : leaderboard;

    return {
      success: true,
      chains: chainIds,
      timeWindow: parsedTimeWindow,
      data: filteredData,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * GET /api/v1/leaderboard/health
   * Health check endpoint for the leaderboard service
   */
  @Get("health")
  async health(): Promise<{ status: string; timestamp: string }> {
    return {
      status: "healthy",
      timestamp: new Date().toISOString(),
    };
  }
}
