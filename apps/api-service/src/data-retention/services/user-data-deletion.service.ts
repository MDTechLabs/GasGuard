import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { randomUUID } from "crypto";
import { User } from "../../database/entities/user.entity";
import { AnalysisResult } from "../../database/entities/analysis-result.entity";

/**
 * Request-driven (not time-based) deletion workflows for data tied to a
 * specific user or merchant, e.g. a right-to-erasure request. Kept separate
 * from DataRetentionCleanupService, which only handles age-based purges.
 */
@Injectable()
export class UserDataDeletionService {
  private readonly logger = new Logger(UserDataDeletionService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(AnalysisResult)
    private readonly analysisResultRepo: Repository<AnalysisResult>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Irreversibly scrubs a user's personal fields in place rather than
   * hard-deleting the row. Audit logs (audit_logs) are append-only and keep
   * referencing the same user id for compliance traceability (see
   * docs/AUDIT_LOGGING_SYSTEM.md); anonymizing the user record — instead of
   * deleting it — keeps that trail intact without retaining PII.
   */
  async anonymizeUser(userId: string): Promise<{ userId: string }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    const placeholder = randomUUID();
    user.email = `deleted-${placeholder}@anonymized.invalid`;
    user.firstName = undefined;
    user.lastName = undefined;
    user.passwordHash = randomUUID();
    user.lastLoginIp = undefined;
    user.isActive = false;

    await this.userRepo.save(user);
    this.logger.log(`Anonymized user ${userId}`);
    return { userId };
  }

  /**
   * Deletes all scanned source code and findings (analysis_results) owned by
   * a merchant. Distinct from time-based retention: this is triggered
   * explicitly, e.g. on merchant offboarding or an erasure request that
   * extends to submitted repositories.
   *
   * The deletion runs inside a transaction so that a partial failure
   * cannot leave the merchant's data half-purged; the transaction is rolled
   * back and the error is re-thrown for the caller to handle.
   */
  async purgeAnalysisResultsForMerchant(
    merchantId: string,
  ): Promise<{ merchantId: string; deleted: number }> {
    try {
      const deleted = await this.dataSource.transaction(async (manager) => {
        const result = await manager.delete(AnalysisResult, { merchantId });
        return result.affected || 0;
      });
      this.logger.log(
        `Purged ${deleted} analysis result(s) for merchant ${merchantId}`,
      );
      return { merchantId, deleted };
    } catch (error) {
      this.logger.error(
        `Failed to purge analysis results for merchant ${merchantId}: ${(error as Error).message}`,
      );
      throw error;
    }
  }
}
