import {
  Controller,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { DataRetentionCleanupService } from "../services/data-retention-cleanup.service";
import { UserDataDeletionService } from "../services/user-data-deletion.service";
import { ConfirmDeletionDto } from "../dto/confirm-deletion.dto";
import { AdminOnly } from "../../rbac/decorators";
import { RolesGuard } from "../../rbac/guards";

/**
 * Manual/on-demand entry points for the workflows documented in
 * docs/DATA_RETENTION_AND_DELETION.md (Issue #1011). Admin-only: these purge
 * or irreversibly anonymize data.
 */
@ApiTags("Data Retention")
@Controller("admin/data-retention")
@UseGuards(RolesGuard)
@AdminOnly()
export class DataRetentionController {
  private readonly logger = new Logger(DataRetentionController.name);

  constructor(
    private readonly cleanupService: DataRetentionCleanupService,
    private readonly userDataDeletionService: UserDataDeletionService,
  ) {}

  /** Runs the scheduled retention purge (audit logs + analysis results) immediately. */
  @Post("purge")
  @HttpCode(HttpStatus.OK)
  async runCleanup() {
    this.logger.log("Manual data-retention purge triggered");
    try {
      const result = await this.cleanupService.runCleanup();
      this.logger.log("Manual data-retention purge completed");
      return result;
    } catch (error) {
      this.logger.error(
        `Manual data-retention purge failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  /** Anonymizes a user's PII in place; audit log entries keep referencing the same id. */
  @Delete("users/:userId")
  @HttpCode(HttpStatus.OK)
  async deleteUser(
    @Param("userId") userId: string,
    @Body() body: ConfirmDeletionDto,
  ) {
    this.assertConfirmed(body);
    this.logger.log(`Manual user anonymization requested for userId=${userId}`);
    try {
      const result = await this.userDataDeletionService.anonymizeUser(userId);
      this.logger.log(`User anonymization completed for userId=${userId}`);
      return result;
    } catch (error) {
      this.logger.error(
        `User anonymization failed for userId=${userId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  /** Deletes scanned source code and findings for a merchant. */
  @Delete("merchants/:merchantId/analysis-results")
  @HttpCode(HttpStatus.OK)
  async deleteMerchantAnalysisResults(
    @Param("merchantId") merchantId: string,
    @Body() body: ConfirmDeletionDto,
  ) {
    this.assertConfirmed(body);
    this.logger.log(
      `Manual analysis-results purge requested for merchantId=${merchantId}`,
    );
    try {
      const result =
        await this.userDataDeletionService.purgeAnalysisResultsForMerchant(
          merchantId,
        );
      this.logger.log(
        `Analysis-results purge completed for merchantId=${merchantId}`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `Analysis-results purge failed for merchantId=${merchantId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  private assertConfirmed(body: ConfirmDeletionDto): void {
    if (body?.confirm !== "DELETE") {
      throw new BadRequestException(
        'This is a destructive operation. Set "confirm": "DELETE" in the request body to proceed.',
      );
    }
  }
}
