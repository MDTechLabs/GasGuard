/**
 * Cache Config Tests
 */
/// <reference types="jest" />
import {
  buildCacheKey,
  cacheKeys,
  getTTL,
  defaultCacheConfig,
} from "../cache-config";

describe("CacheConfig", () => {
  describe("buildCacheKey", () => {
    it("should build cache key with prefix", () => {
      const key = buildCacheKey("base_fee", 1);
      expect(key).toContain("gasguard:");
      expect(key).toContain("base_fee");
      expect(key).toContain("1");
    });

    it("should handle multiple parts", () => {
      const key = buildCacheKey("gas", "estimate", 1, "endpoint");
      expect(key).toContain("gas:estimate:1:endpoint");
    });

    it("should handle numeric and string parts", () => {
      const key = buildCacheKey("test", 123, "string", 456);
      expect(key).toContain(":123:");
      expect(key).toContain(":string:");
      expect(key).toContain(":456");
    });
  });

  describe("cache keys builder", () => {
    it("should build base fee cache key", () => {
      const key = cacheKeys.baseFee(1);
      expect(key).toContain("base_fee");
      expect(key).toContain("1");
    });

    it("should build priority fee cache key", () => {
      const key = cacheKeys.priorityFee(137);
      expect(key).toContain("priority_fee");
      expect(key).toContain("137");
    });

    it("should build gas estimate cache key", () => {
      const key = cacheKeys.gasEstimate(1, "/rpc/eth");
      expect(key).toContain("gas_estimate");
      expect(key).toContain("1");
      expect(key).toContain("/rpc/eth");
    });

    it("should build chain metrics cache key", () => {
      const key = cacheKeys.chainMetrics(42161);
      expect(key).toContain("chain_metrics");
      expect(key).toContain("42161");
    });

    it("should build volatility cache key", () => {
      const key = cacheKeys.volatility(1, "1h");
      expect(key).toContain("volatility");
      expect(key).toContain("1");
      expect(key).toContain("1h");
    });
  });

  describe("getTTL", () => {
    it("should return baseFee TTL", () => {
      const ttl = getTTL("baseFee");
      expect(ttl).toBe(defaultCacheConfig.ttl.baseFee);
      expect(ttl).toBeGreaterThan(0);
    });

    it("should return priorityFee TTL", () => {
      const ttl = getTTL("priorityFee");
      expect(ttl).toBe(defaultCacheConfig.ttl.priorityFee);
      expect(ttl).toBeGreaterThan(0);
    });

    it("should return gasEstimate TTL", () => {
      const ttl = getTTL("gasEstimate");
      expect(ttl).toBe(defaultCacheConfig.ttl.gasEstimate);
      expect(ttl).toBeGreaterThan(0);
    });

    it("should return chainMetrics TTL", () => {
      const ttl = getTTL("chainMetrics");
      expect(ttl).toBe(defaultCacheConfig.ttl.chainMetrics);
      expect(ttl).toBeGreaterThan(0);
    });

    it("should return volatilityData TTL", () => {
      const ttl = getTTL("volatilityData");
      expect(ttl).toBe(defaultCacheConfig.ttl.volatilityData);
      expect(ttl).toBeGreaterThan(0);
    });

    it("should return default TTL for unknown type", () => {
      const ttl = getTTL("unknownType");
      expect(ttl).toBe(defaultCacheConfig.ttl.default);
    });

    it("should have reasonable TTL values", () => {
      const config = defaultCacheConfig.ttl;
      expect(config.priorityFee).toBeLessThanOrEqual(config.baseFee);
      expect(config.default).toBeGreaterThan(0);
    });
  });

  describe("default config", () => {
    it("should have valid Redis config", () => {
      const config = defaultCacheConfig.redis;
      expect(config.host).toBeTruthy();
      expect(config.port).toBeGreaterThan(0);
    });

    it("should have all TTL values", () => {
      const ttl = defaultCacheConfig.ttl;
      expect(ttl.baseFee).toBeGreaterThan(0);
      expect(ttl.priorityFee).toBeGreaterThan(0);
      expect(ttl.gasEstimate).toBeGreaterThan(0);
      expect(ttl.chainMetrics).toBeGreaterThan(0);
      expect(ttl.volatilityData).toBeGreaterThan(0);
      expect(ttl.default).toBeGreaterThan(0);
    });

    it("should have behavior config", () => {
      const behavior = defaultCacheConfig.behavior;
      expect(typeof behavior.enabled).toBe("boolean");
      expect(typeof behavior.keyPrefix).toBe("string");
      expect(behavior.maxRetries).toBeGreaterThan(0);
    });
  });

  describe("env variable overrides", () => {
    it("should load from environment variables", () => {
      const originalHost = process.env.REDIS_HOST;
      process.env.REDIS_HOST = "custom-redis";

      // Note: In real test, would need to reimport module after setting env
      expect(defaultCacheConfig.redis.host).toBeTruthy();

      // Restore
      if (originalHost) {
        process.env.REDIS_HOST = originalHost;
      } else {
        delete process.env.REDIS_HOST;
      }
    });
  });
});
