/**
 * Rate Limit Integration Tests
 *
 * Integration tests for the rate limiting system including admin endpoints
 * and header responses. Uses mocked Redis for isolation.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, Controller, Get, Version } from "@nestjs/common";
import { RateLimitingModule } from "../rate-limiting.module";
import { RedisService } from "../services/redis.service";
import { RateLimitService } from "../services/rate-limit.service";
import { RateLimitGuard } from "../guards/rate-limit.guard";
import { TierPlan, RATE_LIMIT_HEADERS } from "../schemas/rate-limit.schema";

// Mock Redis for integration tests
const createMockRedisClient = () => ({
  get: jest.fn(),
  set: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn(),
  del: jest.fn(),
  hset: jest.fn(),
  hgetall: jest.fn(),
  pipeline: jest.fn(),
  quit: jest.fn(),
  status: "ready",
  on: jest.fn(),
  connect: jest.fn(),
});

let mockRedisClient: ReturnType<typeof createMockRedisClient>;
let mockPipeline: {
  incr: jest.Mock;
  expire: jest.Mock;
  hset: jest.Mock;
  exec: jest.Mock;
};

// Test controller for integration tests
@Controller("test")
class TestController {
  @Version("1")
  @Get("rate-limited")
  getRateLimited() {
    return { message: "Success" };
  }
}

describe("Rate Limiting Integration", () => {
  let app: INestApplication;
  let redisService: RedisService;
  let rateLimitService: RateLimitService;
  let rateLimitGuard: RateLimitGuard;

  beforeEach(async () => {
    mockRedisClient = createMockRedisClient();
    mockPipeline = {
      incr: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      hset: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    mockRedisClient.pipeline.mockReturnValue(mockPipeline);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        RateLimitingModule.forRoot({
          config: {
            enabled: true,
            fallbackMode: "permissive",
            defaultTier: TierPlan.FREE,
            redis: {
              host: "localhost",
              port: 6379,
              enableReadyCheck: true,
              maxRetriesPerRequest: 3,
            },
          },
        }),
      ],
      controllers: [TestController],
    })
      .overrideProvider(RedisService)
      .useValue({
        isReady: jest.fn().mockReturnValue(true),
        getClient: jest.fn().mockReturnValue(mockRedisClient),
        execute: jest.fn((fn) => fn(mockRedisClient)),
        healthCheck: jest.fn().mockResolvedValue({
          status: "healthy",
          connected: true,
          latency: 5,
        }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    redisService = moduleFixture.get<RedisService>(RedisService);
    rateLimitService = moduleFixture.get<RateLimitService>(RateLimitService);
    rateLimitGuard = moduleFixture.get<RateLimitGuard>(RateLimitGuard);

    await app.init();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  describe("Admin Endpoints", () => {
    describe("getUsage", () => {
      it("should return usage statistics for an API key", async () => {
        mockRedisClient.hgetall.mockResolvedValue({
          apiKey: "test-key-123",
          tier: TierPlan.STANDARD,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        });

        mockRedisClient.get.mockImplementation((key: string) => {
          if (key.includes("minute")) return Promise.resolve("5");
          if (key.includes("hour")) return Promise.resolve("50");
          if (key.includes("day")) return Promise.resolve("200");
          return Promise.resolve("0");
        });

        const usage = await rateLimitService.getUsage("test-key-123");

        expect(usage).not.toBeNull();
        expect(usage!.apiKey).toBe("test-key-123");
        expect(usage!.tier).toBe(TierPlan.STANDARD);
        expect(usage!.minute.used).toBe(5);
        expect(usage!.hour.used).toBe(50);
        expect(usage!.day.used).toBe(200);
      });

      it("should return default usage for new API keys", async () => {
        mockRedisClient.hgetall.mockResolvedValue({}); // No existing config

        const usage = await rateLimitService.getUsage("new-key-456");

        // Returns null when no config found - controller handles default
        expect(usage).toBeNull();
      });

      it("should return null when Redis is unavailable", async () => {
        jest.spyOn(redisService, "isReady").mockReturnValue(false);

        const usage = await rateLimitService.getUsage("test-key");

        expect(usage).toBeNull();
      });
    });

    describe("updateQuota", () => {
      it("should update quota for an API key", async () => {
        mockRedisClient.hgetall.mockResolvedValue({
          apiKey: "test-key-123",
          tier: TierPlan.FREE,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        });

        await rateLimitService.updateQuota("test-key-123", {
          requestsPerMinute: 20,
          requestsPerHour: 200,
          requestsPerDay: 1000,
        });

        expect(mockRedisClient.hset).toHaveBeenCalled();
        const hsetCall = mockRedisClient.hset.mock.calls[0];
        expect(hsetCall[1].apiKey).toBe("test-key-123");
      });

      it("should update tier for an API key", async () => {
        mockRedisClient.hgetall.mockResolvedValue({
          apiKey: "test-key-123",
          tier: TierPlan.FREE,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        });

        await rateLimitService.setTier("test-key-123", TierPlan.PREMIUM);

        expect(mockRedisClient.hset).toHaveBeenCalled();
        const hsetCall = mockRedisClient.hset.mock.calls[0];
        expect(hsetCall[1].tier).toBe(TierPlan.PREMIUM);
      });

      it("should throw error when Redis is unavailable", async () => {
        jest.spyOn(redisService, "isReady").mockReturnValue(false);

        await expect(
          rateLimitService.updateQuota("test-key", { requestsPerMinute: 20 }),
        ).rejects.toThrow("Redis unavailable");
      });
    });

    describe("resetCounter", () => {
      it("should reset counters for an API key", async () => {
        mockRedisClient.del.mockResolvedValue(3);

        await rateLimitService.resetCounter("test-key-123");

        expect(mockRedisClient.del).toHaveBeenCalled();
      });

      it("should throw error when Redis is unavailable", async () => {
        jest.spyOn(redisService, "isReady").mockReturnValue(false);

        await expect(rateLimitService.resetCounter("test-key")).rejects.toThrow(
          "Redis unavailable",
        );
      });
    });
  });

  describe("Rate Limit Headers", () => {
    it("should include rate limit headers in checkLimit response", async () => {
      mockRedisClient.get.mockResolvedValue("0"); // No requests yet

      const result = await rateLimitService.checkLimit("test-key");

      expect(result.limit).toBeGreaterThan(0);
      expect(result.remaining).toBeGreaterThanOrEqual(0);
      expect(result.resetTime).toBeGreaterThan(0);
    });
  });

  describe("Rate Limit Enforcement", () => {
    it("should track requests correctly", async () => {
      mockRedisClient.get.mockResolvedValue("0");

      const result = await rateLimitService.checkLimit("test-key");

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9); // 10 - 0 - 1
    });

    it("should block requests when limit exceeded", async () => {
      mockRedisClient.get.mockResolvedValue("10"); // At limit

      const result = await rateLimitService.checkLimit("test-key");

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it("should increment counters on successful requests", async () => {
      await rateLimitService.incrementCounter("test-key");

      expect(mockPipeline.incr).toHaveBeenCalledTimes(3);
      expect(mockPipeline.expire).toHaveBeenCalledTimes(3);
      expect(mockPipeline.exec).toHaveBeenCalled();
    });
  });

  describe("Tier-based Quotas", () => {
    it("should apply FREE tier quotas by default", async () => {
      mockRedisClient.hgetall.mockResolvedValue({}); // No custom config
      mockRedisClient.get.mockResolvedValue("0");

      const result = await rateLimitService.checkLimit("new-key");

      expect(result.limit).toBe(10); // FREE tier requestsPerMinute
    });

    it("should apply STANDARD tier quotas", async () => {
      mockRedisClient.hgetall.mockResolvedValue({
        apiKey: "standard-key",
        tier: TierPlan.STANDARD,
      });
      mockRedisClient.get.mockResolvedValue("0");

      const result = await rateLimitService.checkLimit("standard-key");

      expect(result.limit).toBe(60); // STANDARD tier requestsPerMinute
    });

    it("should apply PREMIUM tier quotas", async () => {
      mockRedisClient.hgetall.mockResolvedValue({
        apiKey: "premium-key",
        tier: TierPlan.PREMIUM,
      });
      mockRedisClient.get.mockResolvedValue("0");

      const result = await rateLimitService.checkLimit("premium-key");

      expect(result.limit).toBe(300); // PREMIUM tier requestsPerMinute
    });
  });

  describe("Redis Outage Fallback", () => {
    it("should allow requests in permissive mode when Redis is down", async () => {
      jest.spyOn(redisService, "isReady").mockReturnValue(false);

      const result = await rateLimitService.checkLimit("test-key");

      expect(result.allowed).toBe(true);
    });

    it("should return null usage when Redis is down", async () => {
      jest.spyOn(redisService, "isReady").mockReturnValue(false);

      const usage = await rateLimitService.getUsage("test-key");

      expect(usage).toBeNull();
    });
  });
});
