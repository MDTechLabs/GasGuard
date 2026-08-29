import { Controller, Get, Query, Param } from "@nestjs/common";
import { DatabaseAnalyticsService } from "../database/services/database-analytics.service";

@Controller("analytics")
export class AnalyticsController {
  constructor(private readonly analyticsService: DatabaseAnalyticsService) {}

  @Get("dashboard")
  async getDashboardAnalytics(
    @Query("timeRange") timeRange: "24h" | "7d" | "30d" = "7d",
  ) {
    return this.analyticsService.getDashboardAnalytics(timeRange);
  }

  @Get("merchants/:merchantId")
  async getMerchantAnalytics(
    @Param("merchantId") merchantId: string,
    @Query("timeRange") timeRange: "24h" | "7d" | "30d" = "7d",
  ) {
    return this.analyticsService.getMerchantAnalytics(merchantId, timeRange);
  }

  @Get("chains/:chainId")
  async getChainAnalytics(
    @Param("chainId") chainId: string,
    @Query("timeRange") timeRange: "24h" | "7d" | "30d" = "7d",
  ) {
    return this.analyticsService.getChainAnalytics(chainId, timeRange);
  }

  @Get("analysis")
  async getAnalysisMetrics(
    @Query("timeRange") timeRange: "24h" | "7d" | "30d" = "7d",
  ) {
    return this.analyticsService.getAnalysisMetrics(timeRange);
  }

  @Get("performance")
  async getPerformanceMetrics() {
    return this.analyticsService.getPerformanceMetrics();
  }
}
