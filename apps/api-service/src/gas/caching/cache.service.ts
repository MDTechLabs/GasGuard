/**
 * Cache Service
 * Core caching logic with RPC fallback
 */
import { Injectable, Logger } from "@nestjs/common";
import { RedisClient } from "./redis.client";
import { CacheMetricsService } from "./cache-metrics.service";
import { CacheConfig, getTTL, defaultCacheConfig } from "./cache-config";

@Injectable()
export class CacheService {
  private logger = new Logger("CacheService");
  private redis: RedisClient;
  private config: CacheConfig;

  constructor(private metricsService: CacheMetricsService) {
    this.redis = RedisClient.getInstance();
    this.config = defaultCacheConfig;
  }

  /**
   * Initialize cache service
   */
  async initialize(): Promise<void> {
    await this.redis.connect();
    this.logger.log("Cache service initialized");
  }

  /**
   * Get cached value or fetch from provider
   */
  async getOrFetch<T>(
    key: string,
    queryType: string,
    fetcher: () => Promise<T>,
    chainId?: number,
  ): Promise<T> {
    const startTime = Date.now();

    // Check if caching is enabled
    if (!this.config.behavior.enabled) {
      return fetcher();
    }

    try {
      // Try to get from cache
      const cached = await this.redis.get(key);
      if (cached) {
        const elapsed = Date.now() - startTime;
        this.metricsService.recordHit(key, chainId, elapsed);
        this.logger.debug(`Cache HIT for ${key} (${elapsed}ms)`);
        return JSON.parse(cached);
      }
    } catch (error) {
      this.logger.warn(`Cache retrieval failed for ${key}: ${error.message}`);
    }

    // Cache miss - fetch from provider
    const elapsed = Date.now() - startTime;
    this.metricsService.recordMiss(key, chainId, elapsed);

    try {
      const data = await fetcher();

      // Store in cache
      const ttl = getTTL(queryType);
      await this.set(key, data, ttl);

      return data;
    } catch (error) {
      this.logger.error(`Fetch failed for ${key}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Set cache value
   */
  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      const ttlSeconds = ttl || this.config.ttl.default;
      await this.redis.set(key, JSON.stringify(value), ttlSeconds);
      this.logger.debug(`Cached ${key} with TTL ${ttlSeconds}s`);
    } catch (error) {
      this.logger.error(`Failed to cache ${key}: ${error.message}`);
    }
  }

  /**
   * Get cached value
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const cached = await this.redis.get(key);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      this.logger.error(`Failed to retrieve ${key}: ${error.message}`);
      return null;
    }
  }

  /**
   * Invalidate cache by key
   */
  async invalidate(key: string): Promise<void> {
    try {
      await this.redis.delete(key);
      this.logger.debug(`Invalidated cache key: ${key}`);
    } catch (error) {
      this.logger.error(`Failed to invalidate ${key}: ${error.message}`);
    }
  }

  /**
   * Invalidate cache by pattern (e.g., "gasguard:base_fee:1")
   */
  async invalidatePattern(pattern: string): Promise<number> {
    try {
      const count = await this.redis.deletePattern(pattern);
      this.logger.debug(`Invalidated ${count} cache keys matching ${pattern}`);
      return count;
    } catch (error) {
      this.logger.error(
        `Failed to invalidate pattern ${pattern}: ${error.message}`,
      );
      return 0;
    }
  }

  /**
   * Invalidate all cache for a chain
   */
  async invalidateChain(chainId: number): Promise<number> {
    const pattern = `gasguard:*:${chainId}*`;
    return this.invalidatePattern(pattern);
  }

  /**
   * Check if cache is available
   */
  isAvailable(): boolean {
    return this.redis.isConnected() && this.config.behavior.enabled;
  }

  /**
   * Get cache health status
   */
  async getHealthStatus(): Promise<{
    connected: boolean;
    enabled: boolean;
    cacheSize?: number;
  }> {
    return {
      connected: this.redis.isConnected(),
      enabled: this.config.behavior.enabled,
    };
  }

  /**
   * Clear all cache
   */
  async clearAll(): Promise<void> {
    await this.redis.flush();
    this.logger.log("All cache cleared");
  }

  /**
   * Get cache TTL configuration
   */
  getTTLConfig() {
    return this.config.ttl;
  }
}
