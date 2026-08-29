/**
 * Rate Limit Service
 *
 * Core rate limiting logic using sliding window algorithm.
 * Tracks per-API key request counts across minute, hour, and day windows.
 */

import { Injectable, Logger, Inject } from "@nestjs/common";
import { RedisService } from "./redis.service";
import {
  TierPlan,
  QuotaConfig,
  RateLimitStatus,
  UsageStats,
  ApiKeyConfig,
  DEFAULT_TIER_QUOTAS,
  WINDOW_DURATIONS,
  REDIS_KEY_PREFIXES,
} from "../schemas/rate-limit.schema";
import { RateLimitConfig } from "../config/rate-limit.config";

interface WindowCheck {
  window: "minute" | "hour" | "day";
  limit: number;
  duration: number;
}

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);

  constructor(
    private readonly redisService: RedisService,
    @Inject("RATE_LIMIT_CONFIG")
    private readonly config: RateLimitConfig,
  ) {}

  /**
   * Check if a request is allowed for the given API key
   * Returns the most restrictive window that would be exceeded
   */
  async checkLimit(apiKey: string): Promise<RateLimitStatus> {
    if (!this.config.enabled) {
      return {
        allowed: true,
        limit: Infinity,
        remaining: Infinity,
        resetTime: 0,
        window: "minute",
      };
    }

    const quota = await this.getQuotaForKey(apiKey);
    const windows: WindowCheck[] = [
      {
        window: "minute",
        limit: quota.requestsPerMinute,
        duration: WINDOW_DURATIONS.minute,
      },
      {
        window: "hour",
        limit: quota.requestsPerHour,
        duration: WINDOW_DURATIONS.hour,
      },
      {
        window: "day",
        limit: quota.requestsPerDay,
        duration: WINDOW_DURATIONS.day,
      },
    ];

    // Check all windows and find the most restrictive
    for (const { window, limit, duration } of windows) {
      const count = await this.getWindowCount(apiKey, window, duration);
      const resetTime = this.getWindowResetTime(duration);

      if (count >= limit) {
        return {
          allowed: false,
          limit,
          remaining: 0,
          resetTime,
          window,
        };
      }
    }

    // All windows have capacity - return the most restrictive remaining
    const mostRestrictive = windows[0]; // minute window
    const count = await this.getWindowCount(
      apiKey,
      mostRestrictive.window,
      mostRestrictive.duration,
    );

    return {
      allowed: true,
      limit: mostRestrictive.limit,
      remaining: mostRestrictive.limit - count - 1, // -1 for current request
      resetTime: this.getWindowResetTime(mostRestrictive.duration),
      window: mostRestrictive.window,
    };
  }

  /**
   * Increment the request counter for an API key across all windows
   */
  async incrementCounter(apiKey: string): Promise<void> {
    if (!this.redisService.isReady()) {
      this.logger.warn("Redis unavailable, skipping counter increment");
      return;
    }

    const windows: { window: "minute" | "hour" | "day"; duration: number }[] = [
      { window: "minute", duration: WINDOW_DURATIONS.minute },
      { window: "hour", duration: WINDOW_DURATIONS.hour },
      { window: "day", duration: WINDOW_DURATIONS.day },
    ];

    const client = this.redisService.getClient()!;
    const pipeline = client.pipeline();

    for (const { window, duration } of windows) {
      const key = this.getWindowKey(apiKey, window, duration);
      pipeline.incr(key);
      pipeline.expire(key, duration);
    }

    // Update last request timestamp
    const configKey = `${REDIS_KEY_PREFIXES.apiKeyConfig}:${apiKey}`;
    pipeline.hset(configKey, "lastRequestAt", new Date().toISOString());

    try {
      await pipeline.exec();
    } catch (error) {
      this.logger.error("Failed to increment counters:", error.message);
    }
  }

  /**
   * Get usage statistics for an API key
   */
  async getUsage(apiKey: string): Promise<UsageStats | null> {
    const config = await this.getApiKeyConfig(apiKey);
    if (!config) {
      return null;
    }

    const quota = config.customQuota || DEFAULT_TIER_QUOTAS[config.tier];

    const [minuteCount, hourCount, dayCount] = await Promise.all([
      this.getWindowCount(apiKey, "minute", WINDOW_DURATIONS.minute),
      this.getWindowCount(apiKey, "hour", WINDOW_DURATIONS.hour),
      this.getWindowCount(apiKey, "day", WINDOW_DURATIONS.day),
    ]);

    return {
      apiKey,
      tier: config.tier,
      minute: {
        used: minuteCount,
        limit: quota.requestsPerMinute,
        resetTime: this.getWindowResetTime(WINDOW_DURATIONS.minute),
      },
      hour: {
        used: hourCount,
        limit: quota.requestsPerHour,
        resetTime: this.getWindowResetTime(WINDOW_DURATIONS.hour),
      },
      day: {
        used: dayCount,
        limit: quota.requestsPerDay,
        resetTime: this.getWindowResetTime(WINDOW_DURATIONS.day),
      },
      lastRequestAt: config.lastRequestAt,
    };
  }

  /**
   * Reset all counters for an API key
   */
  async resetCounter(apiKey: string): Promise<void> {
    if (!this.redisService.isReady()) {
      throw new Error("Redis unavailable");
    }

    const client = this.redisService.getClient()!;
    const windows: ("minute" | "hour" | "day")[] = ["minute", "hour", "day"];

    const keysToDelete: string[] = [];

    for (const window of windows) {
      const duration = WINDOW_DURATIONS[window];
      const key = this.getWindowKey(apiKey, window, duration);
      keysToDelete.push(key);
    }

    if (keysToDelete.length > 0) {
      await client.del(...keysToDelete);
    }

    this.logger.log(`Reset rate limit counters for API key: ${apiKey}`);
  }

  /**
   * Update quota configuration for an API key
   */
  async updateQuota(
    apiKey: string,
    quota: Partial<QuotaConfig>,
  ): Promise<void> {
    if (!this.redisService.isReady()) {
      throw new Error("Redis unavailable");
    }

    const client = this.redisService.getClient()!;
    const configKey = `${REDIS_KEY_PREFIXES.apiKeyConfig}:${apiKey}`;

    // Get existing config or create new
    const existing = await this.getApiKeyConfig(apiKey);
    const updatedQuota: QuotaConfig = {
      requestsPerMinute:
        quota.requestsPerMinute ??
        existing?.customQuota?.requestsPerMinute ??
        DEFAULT_TIER_QUOTAS[TierPlan.FREE].requestsPerMinute,
      requestsPerHour:
        quota.requestsPerHour ??
        existing?.customQuota?.requestsPerHour ??
        DEFAULT_TIER_QUOTAS[TierPlan.FREE].requestsPerHour,
      requestsPerDay:
        quota.requestsPerDay ??
        existing?.customQuota?.requestsPerDay ??
        DEFAULT_TIER_QUOTAS[TierPlan.FREE].requestsPerDay,
    };

    const config: ApiKeyConfig = {
      apiKey,
      tier: existing?.tier ?? this.config.defaultTier,
      customQuota: updatedQuota,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await client.hset(configKey, {
      apiKey: config.apiKey,
      tier: config.tier,
      customQuota: JSON.stringify(config.customQuota),
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    });

    this.logger.log(`Updated quota for API key: ${apiKey}`);
  }

  /**
   * Set or update the tier for an API key
   */
  async setTier(apiKey: string, tier: TierPlan): Promise<void> {
    if (!this.redisService.isReady()) {
      throw new Error("Redis unavailable");
    }

    const client = this.redisService.getClient()!;
    const configKey = `${REDIS_KEY_PREFIXES.apiKeyConfig}:${apiKey}`;

    const existing = await this.getApiKeyConfig(apiKey);
    const config: ApiKeyConfig = {
      apiKey,
      tier,
      customQuota: existing?.customQuota,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await client.hset(configKey, {
      apiKey: config.apiKey,
      tier: config.tier,
      customQuota: config.customQuota ? JSON.stringify(config.customQuota) : "",
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    });

    this.logger.log(`Set tier ${tier} for API key: ${apiKey}`);
  }

  /**
   * Get the effective quota for an API key
   */
  private async getQuotaForKey(apiKey: string): Promise<QuotaConfig> {
    const config = await this.getApiKeyConfig(apiKey);

    if (config?.customQuota) {
      return config.customQuota;
    }

    const tier = config?.tier ?? this.config.defaultTier;
    return DEFAULT_TIER_QUOTAS[tier];
  }

  /**
   * Get API key configuration from Redis
   */
  private async getApiKeyConfig(
    apiKey: string,
  ): Promise<(ApiKeyConfig & { lastRequestAt?: string }) | null> {
    if (!this.redisService.isReady()) {
      return null;
    }

    const client = this.redisService.getClient()!;
    const configKey = `${REDIS_KEY_PREFIXES.apiKeyConfig}:${apiKey}`;

    const data = await client.hgetall(configKey);

    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    return {
      apiKey: data.apiKey,
      tier: data.tier as TierPlan,
      customQuota: data.customQuota ? JSON.parse(data.customQuota) : undefined,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      lastRequestAt: data.lastRequestAt,
    };
  }

  /**
   * Get the current count for a specific window
   */
  private async getWindowCount(
    apiKey: string,
    window: "minute" | "hour" | "day",
    duration: number,
  ): Promise<number> {
    if (!this.redisService.isReady()) {
      return 0;
    }

    const key = this.getWindowKey(apiKey, window, duration);
    const client = this.redisService.getClient()!;

    const count = await client.get(key);
    return parseInt(count || "0", 10);
  }

  /**
   * Generate Redis key for a specific window
   */
  private getWindowKey(
    apiKey: string,
    window: string,
    duration: number,
  ): string {
    // Use current timestamp rounded to window boundary for sliding window effect
    const now = Math.floor(Date.now() / 1000);
    const windowStart = Math.floor(now / duration) * duration;
    return `${REDIS_KEY_PREFIXES.rateLimit}:${apiKey}:${window}:${windowStart}`;
  }

  /**
   * Calculate when the current window will reset
   */
  private getWindowResetTime(duration: number): number {
    const now = Math.floor(Date.now() / 1000);
    const windowStart = Math.floor(now / duration) * duration;
    return windowStart + duration;
  }
}
