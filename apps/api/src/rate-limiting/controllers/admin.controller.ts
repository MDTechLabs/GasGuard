/**
 * Rate Limit Admin Controller
 *
 * Admin endpoints for managing API key quotas and viewing usage statistics.
 * All endpoints are prefixed with /admin/api-keys
 */

import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  HttpException,
  HttpStatus,
  Logger,
  Version,
} from "@nestjs/common";
import { RateLimitService } from "../services/rate-limit.service";
import { RedisService } from "../services/redis.service";
import {
  QuotaConfig,
  TierPlan,
  UsageStats,
  MAX_TRANSACTION_LIMITS,
} from "../schemas/rate-limit.schema";

interface UpdateQuotaDto {
  requestsPerMinute?: number;
  requestsPerHour?: number;
  requestsPerDay?: number;
  tier?: TierPlan;
}

interface QuotaResponse {
  apiKey: string;
  quota: QuotaConfig;
  tier: TierPlan;
  updatedAt: string;
}

interface ResetResponse {
  apiKey: string;
  message: string;
  resetAt: string;
}

@Controller("admin/api-keys")
export class RateLimitAdminController {
  private readonly logger = new Logger(RateLimitAdminController.name);

  constructor(
    private readonly rateLimitService: RateLimitService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Get usage statistics for an API key
   * GET /admin/api-keys/:key/usage
   */
  @Version("1")
  @Get(":key/usage")
  async getUsage(@Param("key") apiKey: string): Promise<UsageStats> {
    this.logger.log(`Getting usage for API key: ${apiKey}`);

    // Check Redis availability
    if (!this.redisService.isReady()) {
      throw new HttpException(
        {
          error: "Service Unavailable",
          message: "Rate limiting service temporarily unavailable",
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const usage = await this.rateLimitService.getUsage(apiKey);

    if (!usage) {
      // Return default usage stats for new keys
      return {
        apiKey,
        tier: TierPlan.FREE,
        minute: { used: 0, limit: 10, resetTime: this.getResetTime(60) },
        hour: { used: 0, limit: 100, resetTime: this.getResetTime(3600) },
        day: { used: 0, limit: 500, resetTime: this.getResetTime(86400) },
      };
    }

    return usage;
  }

  /**
   * Update quota for an API key
   * POST /admin/api-keys/:key/quota
   */
  @Version("1")
  @Post(":key/quota")
  async updateQuota(
    @Param("key") apiKey: string,
    @Body() dto: UpdateQuotaDto,
  ): Promise<QuotaResponse> {
    this.logger.log(`Updating quota for API key: ${apiKey}`);

    // Check Redis availability
    if (!this.redisService.isReady()) {
      throw new HttpException(
        {
          error: "Service Unavailable",
          message: "Rate limiting service temporarily unavailable",
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    // Validate input
    if (
      !dto ||
      (!dto.requestsPerMinute &&
        !dto.requestsPerHour &&
        !dto.requestsPerDay &&
        !dto.tier)
    ) {
      throw new HttpException(
        {
          error: "Invalid Request",
          message: "At least one quota field or tier must be provided",
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate quota values
    const quota: Partial<QuotaConfig> = {};

    if (dto.requestsPerMinute !== undefined) {
      if (
        dto.requestsPerMinute < 1 ||
        dto.requestsPerMinute > MAX_TRANSACTION_LIMITS.requestsPerMinute
      ) {
        throw new HttpException(
          {
            error: "Invalid Request",
            message: `requestsPerMinute must be between 1 and ${MAX_TRANSACTION_LIMITS.requestsPerMinute}`,
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      quota.requestsPerMinute = dto.requestsPerMinute;
    }

    if (dto.requestsPerHour !== undefined) {
      if (
        dto.requestsPerHour < 1 ||
        dto.requestsPerHour > MAX_TRANSACTION_LIMITS.requestsPerHour
      ) {
        throw new HttpException(
          {
            error: "Invalid Request",
            message: `requestsPerHour must be between 1 and ${MAX_TRANSACTION_LIMITS.requestsPerHour}`,
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      quota.requestsPerHour = dto.requestsPerHour;
    }

    if (dto.requestsPerDay !== undefined) {
      if (
        dto.requestsPerDay < 1 ||
        dto.requestsPerDay > MAX_TRANSACTION_LIMITS.requestsPerDay
      ) {
        throw new HttpException(
          {
            error: "Invalid Request",
            message: `requestsPerDay must be between 1 and ${MAX_TRANSACTION_LIMITS.requestsPerDay}`,
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      quota.requestsPerDay = dto.requestsPerDay;
    }

    // Update tier if provided
    if (dto.tier) {
      const validTiers = Object.values(TierPlan);
      if (!validTiers.includes(dto.tier)) {
        throw new HttpException(
          {
            error: "Invalid Request",
            message: `tier must be one of: ${validTiers.join(", ")}`,
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      await this.rateLimitService.setTier(apiKey, dto.tier);
    }

    // Update quota
    if (Object.keys(quota).length > 0) {
      await this.rateLimitService.updateQuota(apiKey, quota);
    }

    // Get updated usage to return current quota
    const usage = await this.rateLimitService.getUsage(apiKey);

    return {
      apiKey,
      quota: {
        requestsPerMinute: usage?.minute.limit ?? quota.requestsPerMinute ?? 10,
        requestsPerHour: usage?.hour.limit ?? quota.requestsPerHour ?? 100,
        requestsPerDay: usage?.day.limit ?? quota.requestsPerDay ?? 500,
      },
      tier: usage?.tier ?? dto.tier ?? TierPlan.FREE,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Reset counters for an API key
   * DELETE /admin/api-keys/:key/reset
   */
  @Version("1")
  @Delete(":key/reset")
  async resetCounter(@Param("key") apiKey: string): Promise<ResetResponse> {
    this.logger.log(`Resetting counters for API key: ${apiKey}`);

    // Check Redis availability
    if (!this.redisService.isReady()) {
      throw new HttpException(
        {
          error: "Service Unavailable",
          message: "Rate limiting service temporarily unavailable",
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    await this.rateLimitService.resetCounter(apiKey);

    return {
      apiKey,
      message: "Rate limit counters have been reset successfully",
      resetAt: new Date().toISOString(),
    };
  }

  /**
   * Helper to calculate reset time
   */
  private getResetTime(duration: number): number {
    const now = Math.floor(Date.now() / 1000);
    const windowStart = Math.floor(now / duration) * duration;
    return windowStart + duration;
  }
}
