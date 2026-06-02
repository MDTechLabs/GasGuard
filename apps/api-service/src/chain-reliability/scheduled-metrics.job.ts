import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { ChainReliabilityService } from "./services/chain-reliability.service";
import { MetricTimeWindow } from "./entities/chain-performance-metric.entity";

/**
 * Scheduled jobs for automatic metrics collection
 *
 * This service runs periodic tasks to collect chain performance metrics:
 * - Daily metrics: Every hour
 * - Weekly metrics: Every day at midnight
 * - Monthly metrics: Every day at 1 AM
 */
@Injectable()
export class ScheduledMetricsJob {
  private readonly logger = new Logger(ScheduledMetricsJob.name);

  constructor(
    private readonly chainReliabilityService: ChainReliabilityService,
  ) {}

  /**
   * Collect daily metrics every hour
   */
  @Cron("0 * * * *")
  async collectDailyMetrics(): Promise<void> {
    this.logger.log("Starting daily metrics collection...");
    try {
      await this.chainReliabilityService.collectAllChainMetrics(
        MetricTimeWindow.DAILY,
      );
      this.logger.log("Daily metrics collection completed");
    } catch (error) {
      this.logger.error(`Daily metrics collection failed: ${error.message}`);
    }
  }

  /**
   * Collect weekly metrics every day at midnight
   */
  @Cron("0 0 * * *")
  async collectWeeklyMetrics(): Promise<void> {
    this.logger.log("Starting weekly metrics collection...");
    try {
      await this.chainReliabilityService.collectAllChainMetrics(
        MetricTimeWindow.WEEKLY,
      );
      this.logger.log("Weekly metrics collection completed");
    } catch (error) {
      this.logger.error(`Weekly metrics collection failed: ${error.message}`);
    }
  }

  /**
   * Collect monthly metrics every day at 1 AM
   */
  @Cron("0 1 * * *")
  async collectMonthlyMetrics(): Promise<void> {
    this.logger.log("Starting monthly metrics collection...");
    try {
      await this.chainReliabilityService.collectAllChainMetrics(
        MetricTimeWindow.MONTHLY,
      );
      this.logger.log("Monthly metrics collection completed");
    } catch (error) {
      this.logger.error(`Monthly metrics collection failed: ${error.message}`);
    }
  }
}
