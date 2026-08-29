/**
 * Rate Limiting Schemas and Types
 *
 * Defines the data structures for rate limiting including quotas,
 * usage statistics, and tier configurations.
 */

export enum TierPlan {
  FREE = "free",
  STANDARD = "standard",
  PREMIUM = "premium",
  ENTERPRISE = "enterprise",
}

export interface QuotaConfig {
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
}

export interface RateLimitStatus {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: number;
  window: "minute" | "hour" | "day";
}

export interface UsageStats {
  apiKey: string;
  tier: TierPlan;
  minute: {
    used: number;
    limit: number;
    resetTime: number;
  };
  hour: {
    used: number;
    limit: number;
    resetTime: number;
  };
  day: {
    used: number;
    limit: number;
    resetTime: number;
  };
  lastRequestAt?: string;
}

export interface ApiKeyConfig {
  apiKey: string;
  tier: TierPlan;
  customQuota?: QuotaConfig;
  createdAt: string;
  updatedAt: string;
}

export interface RateLimitErrorResponse {
  error: string;
  message: string;
  retryAfter?: number;
}

// Default quota configurations per tier
export const DEFAULT_TIER_QUOTAS: Record<TierPlan, QuotaConfig> = {
  [TierPlan.FREE]: {
    requestsPerMinute: 10,
    requestsPerHour: 100,
    requestsPerDay: 500,
  },
  [TierPlan.STANDARD]: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
    requestsPerDay: 5000,
  },
  [TierPlan.PREMIUM]: {
    requestsPerMinute: 300,
    requestsPerHour: 5000,
    requestsPerDay: 25000,
  },
  [TierPlan.ENTERPRISE]: {
    requestsPerMinute: 1000,
    requestsPerHour: 20000,
    requestsPerDay: 100000,
  },
};

// Maximum allowed quota values for any API key
export const MAX_TRANSACTION_LIMITS = {
  requestsPerMinute: 10000,
  requestsPerHour: 100000,
  requestsPerDay: 1000000,
};

// Window durations in seconds
export const WINDOW_DURATIONS = {
  minute: 60,
  hour: 3600,
  day: 86400,
};

// Redis key prefixes
export const REDIS_KEY_PREFIXES = {
  rateLimit: "ratelimit",
  apiKeyConfig: "apikey:config",
};

// Header names
export const RATE_LIMIT_HEADERS = {
  limit: "X-RateLimit-Limit",
  remaining: "X-RateLimit-Remaining",
  reset: "X-RateLimit-Reset",
  retryAfter: "Retry-After",
};
