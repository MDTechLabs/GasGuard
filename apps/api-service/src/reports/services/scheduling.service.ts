import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { DataAggregationService } from "./data-aggregation.service";
import { ReportGenerationService } from "./report-generation.service";
import { EmailNotificationService } from "./email-notification.service";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Report } from "../entities/report.entity";
import { Merchant } from "../../database/entities/merchant.entity";
import { v4 as uuidv4 } from "uuid";

@Injectable()
export class SchedulingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulingService.name);
  private intervalId: NodeJS.Timeout;

  constructor(
    private dataAggregationService: DataAggregationService,
    private reportGenerationService: ReportGenerationService,
    private emailNotificationService: EmailNotificationService,
    @InjectRepository(Report)
    private reportRepository: Repository<Report>,
    @InjectRepository(Merchant)
    private merchantRepository: Repository<Merchant>,
  ) {}

  async onModuleInit() {
    // Set up recurring tasks if needed
    this.logger.log("Scheduling service initialized");
  }

  async onModuleDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }

  /**
   * Weekly report scheduler - runs every Monday at 08:00 UTC
   */
  @Cron(CronExpression.EVERY_WEEK)
  async handleWeeklyReportSchedule() {
    // Check if today is Monday and the time is around 08:00 UTC
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // 0 = Sunday, 1 = Monday, etc.
    const hour = now.getUTCHours();

    // Since CronExpression.EVERY_WEEK runs daily, we need to check if it's Monday
    if (dayOfWeek !== 1 || hour < 7 || hour > 9) {
      // Allow a 2-hour window around 8am
      return;
    }

    this.logger.log("Starting weekly report generation process");

    try {
      // Get all active merchants
      const merchants = await this.merchantRepository.find({
        where: { status: "active" },
      });

      for (const merchant of merchants) {
        // Skip if merchant doesn't have an email
        if (!merchant.email) {
          this.logger.warn(
            `Skipping weekly report for merchant ${merchant.name} - no email configured`,
          );
          continue;
        }

        // Create a new report record
        const report = new Report();
        report.id = uuidv4();
        report.type = "scheduled";
        report.period = "weekly";
        report.merchantId = merchant.id;
        report.status = "pending";
        report.startDate = this.getPreviousWeekStart();
        report.endDate = this.getPreviousWeekEnd();
        report.scheduledAt = new Date();

        const savedReport = await this.reportRepository.save(report);

        try {
          // Generate aggregated data for the report
          const reportData =
            await this.dataAggregationService.getWeeklyGasUsage(merchant.id);

          // Detect any anomalies in usage
          const anomalies =
            await this.dataAggregationService.detectAbnormalUsage(
              merchant.id,
              "weekly",
            );
          reportData.anomalies = anomalies;

          // Generate report file
          const fileName = `weekly-gas-report-${merchant.id}-${report.startDate.toISOString().split("T")[0]}.csv`;
          const filePath = await this.reportGenerationService.generateCsvReport(
            reportData,
            fileName,
          );

          // Update report status to processing
          await this.reportRepository.update(savedReport.id, {
            status: "processing",
            reportUrl: filePath,
            reportData: reportData,
          });

          // Send email notification
          const emailSent =
            await this.emailNotificationService.sendGasReportEmail(
              merchant.email,
              merchant.name,
              "weekly",
              filePath,
              reportData,
            );

          if (emailSent) {
            // Update report status to completed
            await this.reportRepository.update(savedReport.id, {
              status: "completed",
              sentAt: new Date(),
            });

            this.logger.log(
              `Weekly report sent successfully to ${merchant.email} for merchant ${merchant.name}`,
            );
          } else {
            // Update report status to failed
            await this.reportRepository.update(savedReport.id, {
              status: "failed",
            });

            this.logger.error(
              `Failed to send weekly report to ${merchant.email} for merchant ${merchant.name}`,
            );

            // Send failure notification
            await this.emailNotificationService.sendFailureNotification(
              merchant.email,
              merchant.name,
              "Email delivery failed",
            );
          }
        } catch (error) {
          this.logger.error(
            `Error generating weekly report for merchant ${merchant.name}`,
            error,
          );

          // Update report status to failed
          await this.reportRepository.update(savedReport.id, {
            status: "failed",
          });

          // Send failure notification
          await this.emailNotificationService.sendFailureNotification(
            merchant.email,
            merchant.name,
            error.message,
          );
        }
      }
    } catch (error) {
      this.logger.error("Error in weekly report scheduling", error);
    }
  }

  /**
   * Monthly report scheduler - runs on the first day of each month at 08:00 UTC
   */
  @Cron(CronExpression.EVERY_MONTH)
  async handleMonthlyReportSchedule() {
    // Check if today is the first day of the month
    const now = new Date();
    const dayOfMonth = now.getUTCDate();
    const hour = now.getUTCHours();

    // Since CronExpression.EVERY_MONTH runs daily, we need to check if it's the first day
    if (dayOfMonth !== 1 || hour < 7 || hour > 9) {
      // Allow a 2-hour window around 8am
      return;
    }

    this.logger.log("Starting monthly report generation process");

    try {
      // Get all active merchants
      const merchants = await this.merchantRepository.find({
        where: { status: "active" },
      });

      for (const merchant of merchants) {
        // Skip if merchant doesn't have an email
        if (!merchant.email) {
          this.logger.warn(
            `Skipping monthly report for merchant ${merchant.name} - no email configured`,
          );
          continue;
        }

        // Create a new report record
        const report = new Report();
        report.id = uuidv4();
        report.type = "scheduled";
        report.period = "monthly";
        report.merchantId = merchant.id;
        report.status = "pending";
        report.startDate = this.getPreviousMonthStart();
        report.endDate = this.getPreviousMonthEnd();
        report.scheduledAt = new Date();

        const savedReport = await this.reportRepository.save(report);

        try {
          // Generate aggregated data for the report
          const reportData =
            await this.dataAggregationService.getMonthlyGasUsage(merchant.id);

          // Detect any anomalies in usage
          const anomalies =
            await this.dataAggregationService.detectAbnormalUsage(
              merchant.id,
              "monthly",
            );
          reportData.anomalies = anomalies;

          // Generate report file
          const fileName = `monthly-gas-report-${merchant.id}-${report.startDate.toISOString().split("T")[0]}.csv`;
          const filePath = await this.reportGenerationService.generateCsvReport(
            reportData,
            fileName,
          );

          // Update report status to processing
          await this.reportRepository.update(savedReport.id, {
            status: "processing",
            reportUrl: filePath,
            reportData: reportData,
          });

          // Send email notification
          const emailSent =
            await this.emailNotificationService.sendGasReportEmail(
              merchant.email,
              merchant.name,
              "monthly",
              filePath,
              reportData,
            );

          if (emailSent) {
            // Update report status to completed
            await this.reportRepository.update(savedReport.id, {
              status: "completed",
              sentAt: new Date(),
            });

            this.logger.log(
              `Monthly report sent successfully to ${merchant.email} for merchant ${merchant.name}`,
            );
          } else {
            // Update report status to failed
            await this.reportRepository.update(savedReport.id, {
              status: "failed",
            });

            this.logger.error(
              `Failed to send monthly report to ${merchant.email} for merchant ${merchant.name}`,
            );

            // Send failure notification
            await this.emailNotificationService.sendFailureNotification(
              merchant.email,
              merchant.name,
              "Email delivery failed",
            );
          }
        } catch (error) {
          this.logger.error(
            `Error generating monthly report for merchant ${merchant.name}`,
            error,
          );

          // Update report status to failed
          await this.reportRepository.update(savedReport.id, {
            status: "failed",
          });

          // Send failure notification
          await this.emailNotificationService.sendFailureNotification(
            merchant.email,
            merchant.name,
            error.message,
          );
        }
      }
    } catch (error) {
      this.logger.error("Error in monthly report scheduling", error);
    }
  }

  /**
   * Process any pending scheduled reports (fallback mechanism)
   */
  @Cron("0 */30 * * * *") // Every 30 minutes
  async processPendingReports() {
    try {
      const pendingReports =
        await this.reportRepository.findByStatus("pending");

      for (const report of pendingReports) {
        // Check if this report was scheduled to run (compare scheduledAt with current time)
        if (report.scheduledAt && new Date() > report.scheduledAt) {
          // Process the report manually
          await this.processScheduledReport(report);
        }
      }
    } catch (error) {
      this.logger.error("Error processing pending reports", error);
    }
  }

  /**
   * Process a scheduled report
   */
  private async processScheduledReport(report: Report) {
    try {
      const merchant = await this.merchantRepository.findOne({
        where: { id: report.merchantId },
      });

      if (!merchant || !merchant.email) {
        this.logger.warn(
          `Cannot process report for merchant ${report.merchantId} - no merchant found or no email`,
        );
        await this.reportRepository.update(report.id, { status: "failed" });
        return;
      }

      // Update report status to processing
      await this.reportRepository.update(report.id, { status: "processing" });

      let reportData;
      if (report.period === "weekly") {
        reportData = await this.dataAggregationService.getWeeklyGasUsage(
          report.merchantId,
        );
        const anomalies = await this.dataAggregationService.detectAbnormalUsage(
          report.merchantId,
          "weekly",
        );
        reportData.anomalies = anomalies;
      } else {
        reportData = await this.dataAggregationService.getMonthlyGasUsage(
          report.merchantId,
        );
        const anomalies = await this.dataAggregationService.detectAbnormalUsage(
          report.merchantId,
          "monthly",
        );
        reportData.anomalies = anomalies;
      }

      // Generate report file
      const fileName = `${report.period}-gas-report-${report.merchantId}-${report.startDate.toISOString().split("T")[0]}.csv`;
      const filePath = await this.reportGenerationService.generateCsvReport(
        reportData,
        fileName,
      );

      // Update report with file path
      await this.reportRepository.update(report.id, {
        reportUrl: filePath,
        reportData: reportData,
      });

      // Send email notification
      const emailSent = await this.emailNotificationService.sendGasReportEmail(
        merchant.email,
        merchant.name,
        report.period as "weekly" | "monthly",
        filePath,
        reportData,
      );

      if (emailSent) {
        // Update report status to completed
        await this.reportRepository.update(report.id, {
          status: "completed",
          sentAt: new Date(),
        });

        this.logger.log(
          `Scheduled report sent successfully to ${merchant.email} for merchant ${merchant.id}`,
        );
      } else {
        // Update report status to failed
        await this.reportRepository.update(report.id, {
          status: "failed",
        });

        this.logger.error(
          `Failed to send scheduled report to ${merchant.email} for merchant ${merchant.id}`,
        );

        // Send failure notification
        await this.emailNotificationService.sendFailureNotification(
          merchant.email,
          merchant.name,
          "Email delivery failed",
        );
      }
    } catch (error) {
      this.logger.error(
        `Error processing scheduled report ${report.id}`,
        error,
      );

      // Update report status to failed
      await this.reportRepository.update(report.id, {
        status: "failed",
      });

      // Get merchant to send failure notification
      const merchant = await this.merchantRepository.findOne({
        where: { id: report.merchantId },
      });

      if (merchant && merchant.email) {
        // Send failure notification
        await this.emailNotificationService.sendFailureNotification(
          merchant.email,
          merchant.name,
          error.message,
        );
      }
    }
  }

  /**
   * Helper method to get the start date of the previous week (Monday)
   */
  private getPreviousWeekStart(): Date {
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // 0 = Sunday, 1 = Monday, etc.
    const diff = now.getUTCDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1) - 7; // Previous Monday

    const monday = new Date(now);
    monday.setUTCDate(diff);
    monday.setUTCHours(0, 0, 0, 0);

    return monday;
  }

  /**
   * Helper method to get the end date of the previous week (Sunday)
   */
  private getPreviousWeekEnd(): Date {
    const startDate = this.getPreviousWeekStart();
    const endDate = new Date(startDate);
    endDate.setUTCDate(endDate.getUTCDate() + 6); // Add 6 days to get to Sunday
    endDate.setUTCHours(23, 59, 59, 999);

    return endDate;
  }

  /**
   * Helper method to get the start date of the previous month
   */
  private getPreviousMonthStart(): Date {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() - 1; // Previous month

    const startDate = new Date(Date.UTC(year, month, 1));
    startDate.setUTCHours(0, 0, 0, 0);

    return startDate;
  }

  /**
   * Helper method to get the end date of the previous month
   */
  private getPreviousMonthEnd(): Date {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth(); // Current month (since we want end of previous month)

    const endDate = new Date(Date.UTC(year, month, 0)); // Day 0 is last day of previous month
    endDate.setUTCHours(23, 59, 59, 999);

    return endDate;
  }
}
