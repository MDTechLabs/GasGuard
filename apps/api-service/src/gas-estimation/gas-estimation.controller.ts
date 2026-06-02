import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { DynamicPricingService } from "./services/dynamic-pricing.service";
import { GasPriceHistoryService } from "./services/gas-price-history.service";
import { NetworkMonitorService } from "./services/network-monitor.service";
import { NetworkConfigService } from "./config/network-config.service";
import {
  GetGasEstimateDto,
  GasEstimateResponseDto,
  GasPriceHistoryDto,
  NetworkMetricsDto,
} from "./dto/gas-estimate.dto";

@ApiTags("Gas Estimation")
@Controller("gas-estimation")
export class GasEstimationController {
  private readonly logger = new Logger(GasEstimationController.name);

  constructor(
    private dynamicPricingService: DynamicPricingService,
    private gasPriceHistoryService: GasPriceHistoryService,
    private networkMonitorService: NetworkMonitorService,
    private networkConfigService: NetworkConfigService,
  ) {}

  /**
   * Get dynamic gas estimate for a transaction
   * Replaces static gas estimation with real-time network-aware pricing
   */
  @Post("estimate")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Get dynamic gas price estimate",
    description:
      "Returns estimated gas cost based on real-time network conditions, with multiple priority options",
  })
  @ApiResponse({
    status: 200,
    description: "Gas estimate with dynamic pricing",
    type: GasEstimateResponseDto,
  })
  async estimateGasPrice(@Body() dto: GetGasEstimateDto): Promise<any> {
    try {
      if (!dto.chainId) {
        throw new BadRequestException("chainId is required");
      }

      if (!dto.estimatedGasUnits || dto.estimatedGasUnits <= 0) {
        throw new BadRequestException(
          "estimatedGasUnits must be greater than 0",
        );
      }

      const priority = dto.priority || "normal";
      const estimate = await this.dynamicPricingService.estimateGasPrice(
        dto.chainId,
        dto.estimatedGasUnits,
        priority,
      );

      return {
        ...estimate,
        confidence: estimate.alternativePrices ? 85 : 70,
      };
    } catch (error) {
      this.logger.error("Failed to estimate gas price", error);
      throw error;
    }
  }

  /**
   * Get multiple price options for different priority levels
   */
  @Post("estimate/multi")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Get multiple gas price options",
    description:
      "Returns gas price estimates for low, normal, high, and critical priority levels",
  })
  async getMultiplePriceOptions(@Body() dto: GetGasEstimateDto): Promise<any> {
    try {
      if (!dto.chainId || !dto.estimatedGasUnits) {
        throw new BadRequestException(
          "chainId and estimatedGasUnits are required",
        );
      }

      return await this.dynamicPricingService.getMultiplePriceOptions(
        dto.chainId,
        dto.estimatedGasUnits,
      );
    } catch (error) {
      this.logger.error("Failed to get multiple price options", error);
      throw error;
    }
  }

  /**
   * Get optimal gas price suggestion based on historical patterns
   */
  @Post("suggest-optimal")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Get optimal gas price suggestion",
    description:
      "Recommends the best gas price based on historical trends and current conditions",
  })
  async suggestOptimalPrice(@Body() dto: GetGasEstimateDto): Promise<any> {
    try {
      if (!dto.chainId || !dto.estimatedGasUnits) {
        throw new BadRequestException(
          "chainId and estimatedGasUnits are required",
        );
      }

      return await this.dynamicPricingService.suggestOptimalPrice(
        dto.chainId,
        dto.estimatedGasUnits,
      );
    } catch (error) {
      this.logger.error("Failed to suggest optimal price", error);
      throw error;
    }
  }

  /**
   * Get current network metrics for a chain
   */
  @Get("network-metrics/:chainId")
  @ApiOperation({
    summary: "Get current network metrics",
    description:
      "Returns real-time network metrics including congestion level, transaction count, and volatility",
  })
  async getNetworkMetrics(@Param("chainId") chainId: string): Promise<any> {
    try {
      if (!chainId) {
        throw new BadRequestException("chainId is required");
      }

      const metrics =
        await this.networkMonitorService.getNetworkMetrics(chainId);
      const snapshot =
        await this.networkMonitorService.getGasPriceSnapshot(chainId);

      return {
        chainId,
        timestamp: new Date().toISOString(),
        ...metrics,
        currentGasPriceSnapshot: {
          basePrice: snapshot.baseFeePerInstruction,
          surgeMultiplier: snapshot.surgePriceMultiplier,
          recommendedPrice: snapshot.recommendedFeeRate,
          priceConfidence: snapshot.priceConfidence,
          volatilityIndex: snapshot.volatilityIndex,
        },
      };
    } catch (error) {
      this.logger.error("Failed to get network metrics", error);
      throw error;
    }
  }

  /**
   * Get historical gas prices
   */
  @Get("history/:chainId")
  @ApiOperation({
    summary: "Get historical gas prices",
    description: "Returns gas price history for analysis and trend detection",
  })
  async getGasPriceHistory(
    @Param("chainId") chainId: string,
    @Body() dto: GasPriceHistoryDto,
  ): Promise<any> {
    try {
      if (!chainId) {
        throw new BadRequestException("chainId is required");
      }

      const hoursBack = dto.hoursBack || 24;
      const history = await this.gasPriceHistoryService.getPriceHistory(
        chainId,
        hoursBack,
      );

      const stats = await this.gasPriceHistoryService.getAveragePriceOverPeriod(
        chainId,
        hoursBack,
      );

      const trend = await this.gasPriceHistoryService.getPriceTrend(chainId);

      return {
        chainId,
        period: `${hoursBack} hours`,
        dataPoints: history.length,
        history,
        statistics: stats,
        trend,
      };
    } catch (error) {
      this.logger.error("Failed to get gas price history", error);
      throw error;
    }
  }

  /**
   * Get analysis of best time windows for low gas prices
   */
  @Get("best-time-windows/:chainId")
  @ApiOperation({
    summary: "Find best times for low gas prices",
    description:
      "Analyzes 7-day history to find optimal time windows with lowest gas prices",
  })
  async getBestTimeWindows(@Param("chainId") chainId: string): Promise<any> {
    try {
      if (!chainId) {
        throw new BadRequestException("chainId is required");
      }

      const bestWindows =
        await this.gasPriceHistoryService.getBestTimeWindowsForLowPrices(
          chainId,
          5,
        );

      return {
        chainId,
        analysisWindow: "7 days",
        timezone: "UTC",
        bestWindows: bestWindows.map((w) => ({
          hour: `${w.hour}:00 UTC`,
          averagePrice: w.averagePrice.toFixed(2),
          occurrences: w.frequency,
          estimatedSavings: `${((1 - w.averagePrice / 1500) * 100).toFixed(1)}% vs baseline`,
        })),
      };
    } catch (error) {
      this.logger.error("Failed to get best time windows", error);
      throw error;
    }
  }

  /**
   * Get price trend analysis
   */
  @Get("trend/:chainId")
  @ApiOperation({
    summary: "Get gas price trend",
    description:
      "Analyzes recent gas price trends to predict future price movements",
  })
  async getPriceTrend(@Param("chainId") chainId: string): Promise<any> {
    try {
      if (!chainId) {
        throw new BadRequestException("chainId is required");
      }

      const trend = await this.gasPriceHistoryService.getPriceTrend(chainId);
      const stats = await this.gasPriceHistoryService.getAveragePriceOverPeriod(
        chainId,
        6,
      );

      return {
        chainId,
        timestamp: new Date().toISOString(),
        trend,
        priceStats: {
          current: stats.max, // Use max as current in this context
          average6h: stats.average,
          min6h: stats.min,
          max6h: stats.max,
          volatility: stats.stdDev,
        },
        recommendation: this.getTrendRecommendation(
          trend.trend,
          trend.percentChange,
        ),
      };
    } catch (error) {
      this.logger.error("Failed to get price trend", error);
      throw error;
    }
  }

  /**
   * Health check for gas estimation service
   */
  @Get("health")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Health check" })
  async health(): Promise<any> {
    return {
      status: "healthy",
      timestamp: new Date().toISOString(),
      version: "1.0.0",
      supportedChains: this.networkConfigService.getSupportedChainIds(),
    };
  }

  /**
   * Helper: Get trend-based recommendation
   */
  private getTrendRecommendation(trend: string, percentChange: number): string {
    if (trend === "increasing") {
      if (percentChange > 10) {
        return "⚠️  Prices rising sharply. Consider executing urgent transactions now if needed.";
      }
      return "📈 Prices trending up. Good time to execute if not urgent.";
    } else if (trend === "decreasing") {
      if (percentChange < -10) {
        return "✅ Prices falling significantly. Optimal time for non-urgent transactions.";
      }
      return "📉 Prices trending down. Wait for cheaper rates if possible.";
    } else {
      return "➡️  Prices stable. Safe to execute at any time.";
    }
  }
}
