/**
 * Rate Limit Service Unit Tests
 *
 * Tests for the core rate limiting logic including sliding window algorithm,
 * quota enforcement, and Redis outage fallback.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { RateLimitService } from "../services/rate-limit.service";
import { RedisService } from "../services/redis.service";
import {
  TierPlan,
  QuotaConfig,
  DEFAULT_TIER_QUOTAS,
  WINDOW_DURATIONS,
} from "../schemas/rate-limit.schema";
import { RateLimitConfig } from "../config/rate-limit.config";

// Mock Redis
const mockRedisClient = {
  get: jest.fn(),
  set: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn(),
  del: jest.fn(),
  hset: jest.fn(),
  hgetall: jest.fn(),
  pipeline: jest.fn(),
};

const mockPipeline = {
  incr: jest.fn().mockReturnThis(),
  expire: jest.fn().mockReturnThis(),
  hset: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue([]),
};

mockRedisClient.pipeline.mockReturnValue(mockPipeline);

// Mock RedisService
const mockRedisService = {
  isReady: jest.fn().mockReturnValue(true),
  getClient: jest.fn().mockReturnValue(mockRedisClient),
  execute: jest.fn(),
};

describe("RateLimitService", () => {
  let service: RateLimitService;

  const mockConfig: RateLimitConfig = {
    redis: {
      host: "localhost",
      port: 6379,
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
    },
    fallbackMode: "permissive",
    defaultTier: TierPlan.FREE,
    enabled: true,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRedisService.isReady.mockReturnValue(true);
    mockRedisService.getClient.mockReturnValue(mockRedisClient);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimitService,
        {
          provide: "RATE_LIMIT_CONFIG",
          useValue: mockConfig,
        },
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
      ],
    }).compile();

    service = module.get<RateLimitService>(RateLimitService);
  });

  describe("checkLimit", () => {
    it("should allow request when under limit", async () => {
      mockRedisClient.get.mockResolvedValue("5"); // 5 requests made

      const result = await service.checkLimit("test-api-key");

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(
        DEFAULT_TIER_QUOTAS[TierPlan.FREE].requestsPerMinute,
      );
      expect(result.remaining).toBe(
        DEFAULT_TIER_QUOTAS[TierPlan.FREE].requestsPerMinute - 5 - 1,
      );
    });

    it("should deny request when minute limit exceeded", async () => {
      mockRedisClient.get.mockImplementation((key: string) => {
        if (key.includes("minute")) return Promise.resolve("10"); // At limit
        return Promise.resolve("0");
      });

      const result = await service.checkLimit("test-api-key");

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.window).toBe("minute");
    });

    it("should deny request when hour limit exceeded", async () => {
      mockRedisClient.get.mockImplementation((key: string) => {
        if (key.includes("minute")) return Promise.resolve("5");
        if (key.includes("hour")) return Promise.resolve("100"); // At limit
        return Promise.resolve("0");
      });

      const result = await service.checkLimit("test-api-key");

      expect(result.allowed).toBe(false);
      expect(result.window).toBe("hour");
    });

    it("should deny request when day limit exceeded", async () => {
      mockRedisClient.get.mockImplementation((key: string) => {
        if (key.includes("minute")) return Promise.resolve("5");
        if (key.includes("hour")) return Promise.resolve("50");
        if (key.includes("day")) return Promise.resolve("500"); // At limit
        return Promise.resolve("0");
      });

      const result = await service.checkLimit("test-api-key");

      expect(result.allowed).toBe(false);
      expect(result.window).toBe("day");
    });

    it("should allow all requests when rate limiting is disabled", async () => {
      const disabledConfig = { ...mockConfig, enabled: false };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RateLimitService,
          {
            provide: "RATE_LIMIT_CONFIG",
            useValue: disabledConfig,
          },
          {
            provide: RedisService,
            useValue: mockRedisService,
          },
        ],
      }).compile();

      const disabledService = module.get<RateLimitService>(RateLimitService);
      const result = await disabledService.checkLimit("test-api-key");

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(Infinity);
    });

    it("should handle Redis outage gracefully", async () => {
      mockRedisService.isReady.mockReturnValue(false);

      const result = await service.checkLimit("test-api-key");

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(
        DEFAULT_TIER_QUOTAS[TierPlan.FREE].requestsPerMinute,
      );
    });
  });

  describe("incrementCounter", () => {
    it("should increment counters for all windows", async () => {
      await service.incrementCounter("test-api-key");

      expect(mockPipeline.incr).toHaveBeenCalledTimes(3); // minute, hour, day
      expect(mockPipeline.expire).toHaveBeenCalledTimes(3);
      expect(mockPipeline.exec).toHaveBeenCalled();
    });

    it("should not fail when Redis is unavailable", async () => {
      mockRedisService.isReady.mockReturnValue(false);

      await expect(
        service.incrementCounter("test-api-key"),
      ).resolves.not.toThrow();
    });
  });

  describe("getUsage", () => {
    it("should return usage statistics", async () => {
      mockRedisClient.get.mockImplementation((key: string) => {
        if (key.includes("minute")) return Promise.resolve("5");
        if (key.includes("hour")) return Promise.resolve("50");
        if (key.includes("day")) return Promise.resolve("200");
        return Promise.resolve("0");
      });

      mockRedisClient.hgetall.mockResolvedValue({
        apiKey: "test-api-key",
        tier: TierPlan.STANDARD,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      });

      const usage = await service.getUsage("test-api-key");

      expect(usage).not.toBeNull();
      expect(usage!.apiKey).toBe("test-api-key");
      expect(usage!.tier).toBe(TierPlan.STANDARD);
      expect(usage!.minute.used).toBe(5);
      expect(usage!.hour.used).toBe(50);
      expect(usage!.day.used).toBe(200);
    });

    it("should return null for unknown API key when Redis unavailable", async () => {
      mockRedisService.isReady.mockReturnValue(false);

      const usage = await service.getUsage("unknown-key");

      expect(usage).toBeNull();
    });
  });

  describe("resetCounter", () => {
    it("should delete all window keys", async () => {
      mockRedisClient.del.mockResolvedValue(3);

      await service.resetCounter("test-api-key");

      expect(mockRedisClient.del).toHaveBeenCalled();
    });

    it("should throw error when Redis is unavailable", async () => {
      mockRedisService.isReady.mockReturnValue(false);

      await expect(service.resetCounter("test-api-key")).rejects.toThrow(
        "Redis unavailable",
      );
    });
  });

  describe("updateQuota", () => {
    it("should update quota configuration", async () => {
      const newQuota: Partial<QuotaConfig> = {
        requestsPerMinute: 20,
        requestsPerHour: 200,
      };

      mockRedisClient.hgetall.mockResolvedValue({
        apiKey: "test-api-key",
        tier: TierPlan.FREE,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      });

      await service.updateQuota("test-api-key", newQuota);

      expect(mockRedisClient.hset).toHaveBeenCalled();
    });

    it("should throw error when Redis is unavailable", async () => {
      mockRedisService.isReady.mockReturnValue(false);

      await expect(
        service.updateQuota("test-api-key", { requestsPerMinute: 20 }),
      ).rejects.toThrow("Redis unavailable");
    });
  });

  describe("setTier", () => {
    it("should set tier for API key", async () => {
      mockRedisClient.hgetall.mockResolvedValue({
        apiKey: "test-api-key",
        tier: TierPlan.FREE,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      });

      await service.setTier("test-api-key", TierPlan.PREMIUM);

      expect(mockRedisClient.hset).toHaveBeenCalled();
      const hsetCall = mockRedisClient.hset.mock.calls[0];
      expect(hsetCall[1].tier).toBe(TierPlan.PREMIUM);
    });
  });

  describe("tier quotas", () => {
    it("should use FREE tier quotas by default", async () => {
      mockRedisClient.hgetall.mockResolvedValue({}); // No config found
      mockRedisClient.get.mockResolvedValue("0");

      const result = await service.checkLimit("new-api-key");

      expect(result.limit).toBe(
        DEFAULT_TIER_QUOTAS[TierPlan.FREE].requestsPerMinute,
      );
    });

    it("should use correct quotas for each tier", () => {
      const tiers = [
        TierPlan.FREE,
        TierPlan.STANDARD,
        TierPlan.PREMIUM,
        TierPlan.ENTERPRISE,
      ];

      tiers.forEach((tier) => {
        const quotas = DEFAULT_TIER_QUOTAS[tier];
        expect(quotas.requestsPerMinute).toBeGreaterThan(0);
        expect(quotas.requestsPerHour).toBeGreaterThan(
          quotas.requestsPerMinute,
        );
        expect(quotas.requestsPerDay).toBeGreaterThan(quotas.requestsPerHour);
      });
    });
  });
});
