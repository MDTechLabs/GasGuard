import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AnalysisResult } from "../../database/entities/analysis-result.entity";
import { AuditLogService } from "../../audit/services/audit-log.service";
import { getRetentionPolicy } from "../config/retention-policy.config";

/**
 * Scheduled purge of time-boxed data categories: audit logs and analysis
 * results (which hold both the "repositories" scanned source and the
 * "findings" produced from them). User data is handled separately by
 * UserDataDeletionService since it is request-driven, not time-driven.
 */
@Injectable()
export class DataRetentionCleanupService {
  private readonly logger = new Logger(DataRetentionCleanupService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly auditLogService: AuditLogService,
    @InjectRepository(AnalysisResult)
    private readonly analysisResultRepo: Repository<AnalysisResult>,
  ) {}

  /** Daily at 2 AM, after the backup window referenced in DATABASE_BACKUP_RESTORE.md. */
  @Cron("0 2 * * *")
  async handleScheduledCleanup(): Promise<void> {
    this.logger.log("Starting scheduled data retention cleanup...");
    try {
      const result = await this.runCleanup();
      this.logger.log(
        `Retention cleanup complete: ${result.auditLogsDeleted} audit logs, ` +
          `${result.analysisResultsDeleted} analysis results removed`,
      );
    } catch (error) {
      this.logger.error("Retention cleanup failed", error);
    }
  }

  /**
   * Runs the purge immediately using the configured policy. Used by both the
   * cron job and the manual admin-triggered endpoint so both paths share one
   * code path and one set of safety semantics.
   */
  async runCleanup(): Promise<{
    auditLogsDeleted: number;
    analysisResultsDeleted: number;
  }> {
    const policy = getRetentionPolicy(this.configService);

    const auditLogsDeleted = await this.auditLogService.retentionCleanup(
      policy.auditLogRetentionDays,
    );
    const analysisResultsDeleted = await this.deleteAnalysisResultsOlderThan(
      policy.analysisResultRetentionDays,
    );

    return { auditLogsDeleted, analysisResultsDeleted };
  }

  private async deleteAnalysisResultsOlderThan(days: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const result = await this.analysisResultRepo
      .createQueryBuilder()
      .delete()
      .where("createdAt < cutoff", { cutoff: cutoffDate })
      .execute();

    return result.affected || 0;
  }
}
