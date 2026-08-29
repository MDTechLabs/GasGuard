/**
 * Cache Configuration
 * Defines TTL values and cache settings for different query types
 */
export interface CacheConfig {
  // Redis connection
  redis: {
    host: string;
    port: number;
    password?: string;
    db?: number;
    lazyConnect?: boolean;
    enableReadyCheck?: boolean;
    enableOfflineQueue?: boolean;
  };

  // Cache TTL (time-to-live) in seconds
  ttl: {
    baseFee: number; // Usually stable per block, 1-5 min
    priorityFee: number; // More volatile, 30-60 sec
    gasEstimate: number; // Stable, 2-5 min
    chainMetrics: number; // Stable, 5-10 min
    volatilityData: number; // Historical, 10-30 min
    default: number; // Fallback TTL
  };

  // Cache behavior
  behavior: {
    enabled: boolean;
    staleWhileRevalidate?: number; // Serve stale data while refreshing (sec)
    maxRetries?: number; // Redis connection retries
    keyPrefix?: string; // Cache key namespace
  };
}

/**
 * Default cache configuration
 */
export const defaultCacheConfig: CacheConfig = {
  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379", 10),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || "0", 10),
    lazyConnect: true,
    enableReadyCheck: true,
    enableOfflineQueue: false,
  },
  ttl: {
    baseFee: parseInt(process.env.CACHE_TTL_BASE_FEE || "120", 10),
    priorityFee: parseInt(process.env.CACHE_TTL_PRIORITY_FEE || "60", 10),
    gasEstimate: parseInt(process.env.CACHE_TTL_GAS_ESTIMATE || "180", 10),
    chainMetrics: parseInt(process.env.CACHE_TTL_CHAIN_METRICS || "300", 10),
    volatilityData: parseInt(process.env.CACHE_TTL_VOLATILITY || "600", 10),
    default: parseInt(process.env.CACHE_TTL_DEFAULT || "180", 10),
  },
  behavior: {
    enabled: process.env.CACHE_ENABLED !== "false",
    staleWhileRevalidate: parseInt(process.env.CACHE_STALE_TTL || "30", 10),
    maxRetries: 3,
    keyPrefix: "gasguard:",
  },
};

/**
 * Build Redis cache key from parts
 */
export function buildCacheKey(...parts: (string | number)[]): string {
  const prefix = defaultCacheConfig.behavior.keyPrefix || "gasguard:";
  return `${prefix}${parts.join(":")}`;
}

/**
 * Cache key builders for different query types
 */
export const cacheKeys = {
  baseFee: (chainId: number) => buildCacheKey("base_fee", chainId),
  priorityFee: (chainId: number) => buildCacheKey("priority_fee", chainId),
  gasEstimate: (chainId: number, endpoint: string) =>
    buildCacheKey("gas_estimate", chainId, endpoint),
  chainMetrics: (chainId: number) => buildCacheKey("chain_metrics", chainId),
  volatility: (chainId: number, period: string) =>
    buildCacheKey("volatility", chainId, period),
};

/**
 * Get TTL for query type
 */
export function getTTL(queryType: string): number {
  const ttlMap = defaultCacheConfig.ttl;
  return ttlMap[queryType as keyof typeof ttlMap] || ttlMap.default;
}
