import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Report } from "../entities/report.entity";
import { DataAggregationService } from "./data-aggregation.service";
import { ReportGenerationService } from "./report-generation.service";
import { EmailNotificationService } from "./email-notification.service";
import { Merchant } from "../../database/entities/merchant.entity";
import { v4 as uuidv4 } from "uuid";

@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name);

  constructor(
    @InjectRepository(Report)
    private reportRepository: Repository<Report>,
    @InjectRepository(Merchant)
    private merchantRepository: Repository<Merchant>,
    private dataAggregationService: DataAggregationService,
    private reportGenerationService: ReportGenerationService,
    private emailNotificationService: EmailNotificationService,
  ) {}

  /**
   * Generate an ad-hoc report for a specific merchant
   */
  async generateAdhocReport(
    merchantId: string,
    period: "weekly" | "monthly",
  ): Promise<string> {
    try {
      // Validate merchant exists
      const merchant = await this.merchantRepository.findOne({
        where: { id: merchantId },
      });

      if (!merchant) {
        throw new Error(`Merchant with ID ${merchantId} not found`);
      }

      // Create a new report record
      const report = new Report();
      report.id = uuidv4();
      report.type = "adhoc";
      report.period = period;
      report.merchantId = merchantId;
      report.status = "pending";

      // Set the date range based on the period
      if (period === "weekly") {
        report.startDate = this.getPreviousWeekStart();
        report.endDate = this.getPreviousWeekEnd();
      } else {
        report.startDate = this.getPreviousMonthStart();
        report.endDate = this.getPreviousMonthEnd();
      }

      report.scheduledAt = new Date();

      const savedReport = await this.reportRepository.save(report);

      // Process the report asynchronously
      this.processReportAsync(savedReport.id);

      return savedReport.id;
    } catch (error) {
      this.logger.error(
        `Error generating ad-hoc report for merchant ${merchantId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Process a report asynchronously
   */
  private async processReportAsync(reportId: string): Promise<void> {
    try {
      const report = await this.reportRepository.findOne({
        where: { id: reportId },
      });

      if (!report) {
        this.logger.error(
          `Report with ID ${reportId} not found for processing`,
        );
        return;
      }

      // Update report status to processing
      await this.reportRepository.update(reportId, { status: "processing" });

      // Get merchant details
      const merchant = await this.merchantRepository.findOne({
        where: { id: report.merchantId },
      });

      if (!merchant) {
        this.logger.error(`Merchant with ID ${report.merchantId} not found`);
        await this.reportRepository.update(reportId, { status: "failed" });
        return;
      }

      // Generate aggregated data for the report
      let reportData;
      if (report.period === "weekly") {
        reportData = await this.dataAggregationService.getWeeklyGasUsage(
          report.merchantId,
        );
      } else {
        reportData = await this.dataAggregationService.getMonthlyGasUsage(
          report.merchantId,
        );
      }

      // Detect any anomalies in usage
      const anomalies = await this.dataAggregationService.detectAbnormalUsage(
        report.merchantId,
        report.period as "weekly" | "monthly",
      );
      reportData.anomalies = anomalies;

      // Generate report file
      const fileName = `gas-report-${report.period}-${report.merchantId}-${report.startDate.toISOString().split("T")[0]}.csv`;
      const filePath = await this.reportGenerationService.generateCsvReport(
        reportData,
        fileName,
      );

      // Update report with file path and data
      await this.reportRepository.update(reportId, {
        status: "processing",
        reportUrl: filePath,
        reportData: reportData,
      });

      // Send email notification if merchant has an email
      if (merchant.email) {
        const emailSent =
          await this.emailNotificationService.sendGasReportEmail(
            merchant.email,
            merchant.name,
            report.period as "weekly" | "monthly",
            filePath,
            reportData,
          );

        if (emailSent) {
          // Update report status to completed
          await this.reportRepository.update(reportId, {
            status: "completed",
            sentAt: new Date(),
          });

          this.logger.log(
            `Ad-hoc report sent successfully to ${merchant.email} for merchant ${merchant.name}`,
          );
        } else {
          // Update report status to failed
          await this.reportRepository.update(reportId, {
            status: "failed",
          });

          this.logger.error(
            `Failed to send ad-hoc report to ${merchant.email} for merchant ${merchant.name}`,
          );

          // Send failure notification
          await this.emailNotificationService.sendFailureNotification(
            merchant.email,
            merchant.name,
            "Email delivery failed",
          );
        }
      } else {
        // Update report status to completed without sending email
        await this.reportRepository.update(reportId, {
          status: "completed",
          sentAt: new Date(),
        });

        this.logger.log(
          `Ad-hoc report generated successfully for merchant ${merchant.name} but no email sent (no email configured)`,
        );
      }
    } catch (error) {
      this.logger.error(`Error processing report ${reportId}`, error);

      // Update report status to failed
      await this.reportRepository.update(reportId, {
        status: "failed",
      });

      // Try to get merchant to send failure notification
      try {
        const report = await this.reportRepository.findOne({
          where: { id: reportId },
        });

        if (report) {
          const merchant = await this.merchantRepository.findOne({
            where: { id: report.merchantId },
          });

          if (merchant && merchant.email) {
            await this.emailNotificationService.sendFailureNotification(
              merchant.email,
              merchant.name,
              error.message,
            );
          }
        }
      } catch (notificationError) {
        this.logger.error(
          `Error sending failure notification`,
          notificationError,
        );
      }
    }
  }

  /**
   * Get report by ID
   */
  async getReportById(reportId: string): Promise<Report | null> {
    return this.reportRepository.findOne({
      where: { id: reportId },
    });
  }

  /**
   * Get report history for a merchant
   */
  async getReportHistory(
    merchantId: string,
    period?: "weekly" | "monthly",
    limit: number = 10,
  ): Promise<Report[]> {
    const query = this.reportRepository
      .createQueryBuilder("report")
      .where("report.merchantId = :merchantId", { merchantId })
      .orderBy("report.createdAt", "DESC")
      .limit(limit);

    if (period) {
      query.andWhere("report.period = :period", { period });
    }

    return query.getMany();
  }

  /**
   * Get all pending reports
   */
  async getPendingReports(): Promise<Report[]> {
    return this.reportRepository.findByStatus("pending");
  }

  /**
   * Retry failed reports
   */
  async retryFailedReports(): Promise<number> {
    const failedReports = await this.reportRepository.findByStatus("failed");
    let processedCount = 0;

    for (const report of failedReports) {
      try {
        // Reset status to pending and reprocess
        await this.reportRepository.update(report.id, {
          status: "pending",
          scheduledAt: new Date(),
        });

        // Process the report asynchronously
        this.processReportAsync(report.id);
        processedCount++;
      } catch (error) {
        this.logger.error(`Error retrying failed report ${report.id}`, error);
      }
    }

    return processedCount;
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
