import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { ApiKeyService } from "./api-key.service";

/**
 * Service to handle scheduled API key expiration tasks
 */
@Injectable()
export class ApiKeyExpirationService {
  private readonly logger = new Logger(ApiKeyExpirationService.name);

  constructor(private readonly apiKeyService: ApiKeyService) {}

  /**
   * Daily job to process expired API keys
   * Runs at midnight every day
   */
  @Cron("0 0 * * *") // Midnight daily
  async handleExpiredKeys(): Promise<void> {
    this.logger.log("Starting daily expired API key cleanup...");

    try {
      const expiredCount = await this.apiKeyService.processExpiredKeys();
      this.logger.log(`Processed ${expiredCount} expired API keys`);
    } catch (error) {
      this.logger.error("Failed to process expired API keys", error);
    }
  }

  /**
   * Daily job to clean up rotated keys that have passed their grace period
   * Runs at 1 AM every day
   */
  @Cron("0 1 * * *") // 1 AM daily
  async cleanupRotatedKeys(): Promise<void> {
    this.logger.log("Starting rotated API key cleanup...");

    try {
      const revokedCount = await this.apiKeyService.cleanupRotatedKeys();
      this.logger.log(
        `Revoked ${revokedCount} rotated API keys past grace period`,
      );
    } catch (error) {
      this.logger.error("Failed to cleanup rotated API keys", error);
    }
  }

  /**
   * Weekly job to check for keys expiring soon
   * Could be used for sending notifications
   * Runs every Monday at 9 AM
   */
  @Cron("0 9 * * 1") // Monday at 9 AM
  async checkExpiringKeys(): Promise<void> {
    this.logger.log("Checking for API keys expiring soon...");

    try {
      const expiringKeys = await this.apiKeyService.getKeysExpiringSoon(7);

      if (expiringKeys.length > 0) {
        this.logger.log(
          `Found ${expiringKeys.length} API keys expiring within 7 days`,
        );

        // Log details for each expiring key (could integrate with notification service)
        for (const key of expiringKeys) {
          this.logger.debug(
            `Key ${key.id} for merchant ${key.merchantId} expires at ${key.expiresAt}`,
          );
        }

        // TODO: Integrate with notification service to alert merchants
        // await this.notificationService.sendExpiryReminders(expiringKeys);
      }
    } catch (error) {
      this.logger.error("Failed to check expiring API keys", error);
    }
  }
}
