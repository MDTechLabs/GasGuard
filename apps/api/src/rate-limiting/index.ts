/**
 * Rate Limiting Module Public API
 *
 * Export all public types, services, and guards for the rate limiting system.
 */

// Services
export { RateLimitService } from "./services/rate-limit.service";
export { RedisService } from "./services/redis.service";

// Guards
export { RateLimitGuard } from "./guards/rate-limit.guard";

// Controllers
export { RateLimitAdminController } from "./controllers/admin.controller";

// Module
export {
  RateLimitingModule,
  RateLimitingModuleOptions,
} from "./rate-limiting.module";

// Config
export { RateLimitConfig, rateLimitConfig } from "./config/rate-limit.config";

// Schemas and Types
export {
  TierPlan,
  QuotaConfig,
  RateLimitStatus,
  UsageStats,
  ApiKeyConfig,
  RateLimitErrorResponse,
  DEFAULT_TIER_QUOTAS,
  WINDOW_DURATIONS,
  REDIS_KEY_PREFIXES,
  RATE_LIMIT_HEADERS,
} from "./schemas/rate-limit.schema";
