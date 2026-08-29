/**
 * Cache Service Tests
 */
/// <reference types="jest" />
import { CacheService } from "../cache.service";
import { CacheMetricsService } from "../cache-metrics.service";
import { RedisClient } from "../redis.client";

describe("CacheService", () => {
  let cacheService: CacheService;
  let metricsService: CacheMetricsService;

  beforeEach(async () => {
    metricsService = new CacheMetricsService();
    cacheService = new CacheService(metricsService);
    await cacheService.initialize();
  });

  afterEach(async () => {
    await cacheService.clearAll();
  });

  describe("getOrFetch", () => {
    it("should return cached value on hit", async () => {
      const key = "test:key";
      const value = { baseFee: "50 gwei" };
      let fetcherCalled = false;
      const fetcher = async () => {
        fetcherCalled = true;
        return value;
      };

      // Set cache
      await cacheService.set(key, value, 300);

      // Get from cache
      const result = await cacheService.getOrFetch(key, "baseFee", fetcher);

      expect(result).toEqual(value);
      expect(fetcherCalled).toBe(false);
    });

    it("should fetch on cache miss", async () => {
      const key = "test:key:miss";
      const value = { priorityFee: "30 gwei" };
      let fetcherCalled = false;
      const fetcher = async () => {
        fetcherCalled = true;
        return value;
      };

      const result = await cacheService.getOrFetch(
        key,
        "priorityFee",
        fetcher,
        1,
      );

      expect(result).toEqual(value);
      expect(fetcherCalled).toBe(true);
    });

    it("should cache fetched value", async () => {
      const key = "test:fetch:cache";
      const value = { gasEstimate: 100000 };
      const fetcher = async () => value;

      await cacheService.getOrFetch(key, "gasEstimate", fetcher, 1);
      const cached = await cacheService.get(key);

      expect(cached).toEqual(value);
    });

    it("should record cache metrics", async () => {
      const key1 = "test:metric:1";
      const key2 = "test:metric:2";
      const value = { data: "test" };
      const fetcher = async () => value;

      // Hit
      await cacheService.set(key1, value, 300);
      await cacheService.getOrFetch(key1, "baseFee", fetcher, 1);

      // Miss
      await cacheService.getOrFetch(key2, "priorityFee", fetcher, 1);

      const metrics = metricsService.getGlobalMetrics();
      expect(metrics.hits).toBeGreaterThan(0);
      expect(metrics.misses).toBeGreaterThan(0);
    });

    it("should handle fetcher errors", async () => {
      const key = "test:error";
      const error = new Error("RPC error");
      const fetcher = async () => {
        throw error;
      };

      await expect(
        cacheService.getOrFetch(key, "baseFee", fetcher),
      ).rejects.toThrow("RPC error");
    });

    it("should respect TTL configuration", async () => {
      const key = "test:ttl";
      const value = { data: "test" };
      const fetcher = async () => value;

      await cacheService.getOrFetch(key, "baseFee", fetcher, 1);

      const ttlConfig = cacheService.getTTLConfig();
      expect(ttlConfig.baseFee).toBeGreaterThan(0);
    });
  });

  describe("invalidation", () => {
    it("should invalidate single key", async () => {
      const key = "test:invalidate";
      const value = { data: "test" };

      await cacheService.set(key, value, 300);
      let cached = await cacheService.get(key);
      expect(cached).toEqual(value);

      await cacheService.invalidate(key);
      cached = await cacheService.get(key);
      expect(cached).toBeNull();
    });

    it("should invalidate chain", async () => {
      const chainId = 1;
      const prefixes = [
        "gasguard:base_fee",
        "gasguard:priority_fee",
        "gasguard:gas_estimate",
      ];

      // Set multiple cache entries
      for (const prefix of prefixes) {
        const key = `${prefix}:${chainId}`;
        await cacheService.set(key, { data: "test" }, 300);
      }

      // Invalidate chain
      const count = await cacheService.invalidateChain(chainId);
      expect(count).toBeGreaterThan(0);
    });

    it("should clear all cache", async () => {
      const keys = ["test:1", "test:2", "test:3"];

      for (const key of keys) {
        await cacheService.set(key, { data: "test" }, 300);
      }

      await cacheService.clearAll();

      for (const key of keys) {
        const cached = await cacheService.get(key);
        expect(cached).toBeNull();
      }
    });
  });

  describe("health status", () => {
    it("should report cache health", async () => {
      const health = await cacheService.getHealthStatus();

      expect(health).toHaveProperty("connected");
      expect(health).toHaveProperty("enabled");
      expect(typeof health.connected).toBe("boolean");
      expect(typeof health.enabled).toBe("boolean");
    });

    it("should report availability", () => {
      const available = cacheService.isAvailable();
      expect(typeof available).toBe("boolean");
    });
  });

  describe("manual cache operations", () => {
    it("should set and get values", async () => {
      const key = "test:manual";
      const value = { chainId: 1, baseFee: "50 gwei" };

      await cacheService.set(key, value, 300);
      const retrieved = await cacheService.get(key);

      expect(retrieved).toEqual(value);
    });

    it("should return null for non-existent keys", async () => {
      const value = await cacheService.get("non:existent:key");
      expect(value).toBeNull();
    });

    it("should handle serialization", async () => {
      const key = "test:serialize";
      const value = {
        baseFee: "50",
        timestamp: new Date().toISOString(),
        nested: { deep: { value: 123 } },
      };

      await cacheService.set(key, value, 300);
      const retrieved = await cacheService.get(key);

      expect(retrieved).toEqual(value);
    });
  });
});
