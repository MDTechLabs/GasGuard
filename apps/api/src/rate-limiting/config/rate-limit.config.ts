/**
 * Rate Limiting Configuration
 *
 * Environment-based configuration for Redis connection and rate limiting settings.
 */

import { TierPlan, DEFAULT_TIER_QUOTAS } from "../schemas/rate-limit.schema";

export interface RateLimitConfig {
  redis: {
    host: string;
    port: number;
    password?: string;
    db?: number;
    keyPrefix?: string;
    enableReadyCheck: boolean;
    maxRetriesPerRequest: number;
  };
  fallbackMode: "permissive" | "strict";
  defaultTier: TierPlan;
  enabled: boolean;
}

export const rateLimitConfig = (): RateLimitConfig => ({
  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379", 10),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || "0", 10),
    keyPrefix: process.env.REDIS_KEY_PREFIX || "gasguard:",

    enableReadyCheck: true,
    maxRetriesPerRequest: 3,
  },
  fallbackMode:
    (process.env.RATE_LIMIT_FALLBACK_MODE as "permissive" | "strict") ||
    "permissive",
  defaultTier:
    (process.env.RATE_LIMIT_TIER_DEFAULT as TierPlan) || TierPlan.FREE,
  enabled: process.env.RATE_LIMIT_ENABLED !== "false",
});

export { TierPlan, DEFAULT_TIER_QUOTAS };
