/**
 * Redis Client Manager
 * Handles Redis connection, reconnection, and error handling
 */
import { Logger } from "@nestjs/common";
import { CacheConfig, defaultCacheConfig } from "./cache-config";

export class RedisClient {
  private static instance: RedisClient;
  private redis: any = null;
  private logger = new Logger("RedisClient");
  private connected = false;
  private retryCount = 0;
  private config: CacheConfig;

  private constructor(config?: Partial<CacheConfig>) {
    this.config = { ...defaultCacheConfig, ...config };
  }

  /**
   * Get singleton instance
   */
  static getInstance(config?: Partial<CacheConfig>): RedisClient {
    if (!RedisClient.instance) {
      RedisClient.instance = new RedisClient(config);
    }
    return RedisClient.instance;
  }

  /**
   * Initialize Redis connection
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    try {
      // Try to use ioredis if available
      let Redis: any;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const ioredis = eval("require('ioredis')");
        Redis = ioredis.default || ioredis;
      } catch {
        this.logger.warn("ioredis not available, using in-memory fallback");
        this.redis = new InMemoryRedis();
        this.connected = true;
        return;
      }

      this.redis = new Redis(this.config.redis);

      this.redis.on("connect", () => {
        this.logger.log("Redis connected successfully");
        this.connected = true;
        this.retryCount = 0;
      });

      this.redis.on("error", (err: Error) => {
        this.logger.error(`Redis error: ${err.message}`);
        this.connected = false;
      });

      this.redis.on("reconnecting", () => {
        this.retryCount++;
        if (this.retryCount > (this.config.behavior.maxRetries || 3)) {
          this.logger.warn(
            "Max Redis retries exceeded, falling back to in-memory cache",
          );
          this.redis = new InMemoryRedis();
          this.connected = true;
        }
      });

      await this.redis.connect?.();
      this.connected = true;
    } catch (error) {
      this.logger.error(`Failed to connect to Redis: ${error.message}`);
      this.logger.warn("Falling back to in-memory cache");
      this.redis = new InMemoryRedis();
      this.connected = true;
    }
  }

  /**
   * Get value from cache
   */
  async get(key: string): Promise<string | null> {
    try {
      return await this.redis.get(key);
    } catch (error) {
      this.logger.error(`Cache GET failed for key ${key}: ${error.message}`);
      return null;
    }
  }

  /**
   * Set value in cache with TTL
   */
  async set(key: string, value: string, ttl?: number): Promise<void> {
    try {
      if (ttl) {
        await this.redis.setex(key, ttl, value);
      } else {
        await this.redis.set(key, value);
      }
    } catch (error) {
      this.logger.error(`Cache SET failed for key ${key}: ${error.message}`);
    }
  }

  /**
   * Delete cache key
   */
  async delete(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      this.logger.error(`Cache DELETE failed for key ${key}: ${error.message}`);
    }
  }

  /**
   * Delete multiple keys by pattern
   */
  async deletePattern(pattern: string): Promise<number> {
    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length === 0) return 0;
      return await this.redis.del(...keys);
    } catch (error) {
      this.logger.error(
        `Cache DELETE pattern failed for ${pattern}: ${error.message}`,
      );
      return 0;
    }
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.redis.exists(key);
      return result > 0;
    } catch (error) {
      this.logger.error(
        `Cache EXISTS check failed for key ${key}: ${error.message}`,
      );
      return false;
    }
  }

  /**
   * Get TTL of key in seconds
   */
  async ttl(key: string): Promise<number> {
    try {
      return await this.redis.ttl(key);
    } catch (error) {
      this.logger.error(
        `Cache TTL check failed for key ${key}: ${error.message}`,
      );
      return -1;
    }
  }

  /**
   * Flush all cache
   */
  async flush(): Promise<void> {
    try {
      await this.redis.flushdb?.();
    } catch (error) {
      this.logger.error(`Cache FLUSH failed: ${error.message}`);
    }
  }

  /**
   * Check connection status
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Close Redis connection
   */
  async disconnect(): Promise<void> {
    if (this.redis?.disconnect) {
      await this.redis.disconnect();
    }
    this.connected = false;
  }
}

/**
 * In-memory fallback cache (for development/testing)
 */
class InMemoryRedis {
  private store = new Map<string, { value: string; expires?: number }>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  async get(key: string): Promise<string | null> {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expires && Date.now() > item.expires) {
      this.store.delete(key);
      return null;
    }
    return item.value;
  }

  async setex(key: string, ttl: number, value: string): Promise<void> {
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);

    this.store.set(key, {
      value,
      expires: Date.now() + ttl * 1000,
    });

    const newTimer = setTimeout(() => {
      this.store.delete(key);
      this.timers.delete(key);
    }, ttl * 1000);

    this.timers.set(key, newTimer);
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, { value });
  }

  async del(key: string): Promise<number> {
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);

    if (this.store.has(key)) {
      this.store.delete(key);
      return 1;
    }
    return 0;
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp(pattern.replace(/\*/g, ".*"));
    return Array.from(this.store.keys()).filter((k) => regex.test(k));
  }

  async exists(key: string): Promise<number> {
    return this.store.has(key) ? 1 : 0;
  }

  async ttl(key: string): Promise<number> {
    const item = this.store.get(key);
    if (!item) return -2;
    if (!item.expires) return -1;
    const ttl = Math.ceil((item.expires - Date.now()) / 1000);
    return ttl > 0 ? ttl : -2;
  }

  async flushdb(): Promise<void> {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.store.clear();
    this.timers.clear();
  }
}
