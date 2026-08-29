import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ConfigService } from "@nestjs/config";
import { ApiKeyService } from "../api-key.service";
import { ApiKeyRepository } from "../api-key.repository";
import { AuditLogService } from "../audit-log.service";
import { ApiKey, ApiKeyStatus } from "../../entities/api-key.entity";
import { EventType } from "../../entities/audit-log.entity";

describe("ApiKeyService", () => {
  let service: ApiKeyService;

  beforeEach(async () => {
    const mockApiKeyRepo = {
      createApiKey: () => Promise.resolve({}),
      findById: () => Promise.resolve(null),
      findByKeyHash: () => Promise.resolve(null),
      findActiveByKeyHash: () => Promise.resolve(null),
      findByMerchantId: () => Promise.resolve({ data: [], total: 0 }),
      updateStatus: () => Promise.resolve(),
      updateApiKey: () => Promise.resolve(),
      recordUsage: () => Promise.resolve(),
      findExpiredKeys: () => Promise.resolve([]),
      findKeysExpiringWithinDays: () => Promise.resolve([]),
      findKeysPastGracePeriod: () => Promise.resolve([]),
      revoke: () => Promise.resolve(),
      isOwnedBy: () => Promise.resolve(false),
    };

    const mockAuditLogService = {
      emitApiKeyEvent: () => {},
    };

    const mockConfigService = {
      get: (key: string, defaultValue: any) => {
        const config: Record<string, any> = {
          API_KEY_DEFAULT_EXPIRY_DAYS: 90,
          API_KEY_ROTATION_GRACE_PERIOD_HOURS: 24,
          API_KEY_PREFIX: "gg",
        };
        return config[key] || defaultValue;
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeyService,
        {
          provide: ApiKeyRepository,
          useValue: mockApiKeyRepo,
        },
        {
          provide: AuditLogService,
          useValue: mockAuditLogService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<ApiKeyService>(ApiKeyService);
  });

  it("should be defined", () => {
    if (!service) throw new Error("Service not defined");
  });

  it("should have createApiKey method", () => {
    if (typeof service.createApiKey !== "function")
      throw new Error("No createApiKey method");
  });

  it("should have validateApiKey method", () => {
    if (typeof service.validateApiKey !== "function")
      throw new Error("No validateApiKey method");
  });

  it("should have getApiKeyStatus method", () => {
    if (typeof service.getApiKeyStatus !== "function")
      throw new Error("No getApiKeyStatus method");
  });

  it("should have listApiKeys method", () => {
    if (typeof service.listApiKeys !== "function")
      throw new Error("No listApiKeys method");
  });

  it("should have rotateApiKey method", () => {
    if (typeof service.rotateApiKey !== "function")
      throw new Error("No rotateApiKey method");
  });

  it("should have revokeApiKey method", () => {
    if (typeof service.revokeApiKey !== "function")
      throw new Error("No revokeApiKey method");
  });

  it("should have processExpiredKeys method", () => {
    if (typeof service.processExpiredKeys !== "function")
      throw new Error("No processExpiredKeys method");
  });

  it("should have hashApiKey method", () => {
    if (typeof service.hashApiKey !== "function")
      throw new Error("No hashApiKey method");
  });

  it("should consistently hash API keys", () => {
    const key = "test-api-key";
    const hash1 = service.hashApiKey(key);
    const hash2 = service.hashApiKey(key);

    if (hash1 !== hash2) throw new Error("Hash is not consistent");
    if (hash1.length !== 64)
      throw new Error("SHA256 hash should be 64 characters");
  });

  it("should produce different hashes for different keys", () => {
    const hash1 = service.hashApiKey("key1");
    const hash2 = service.hashApiKey("key2");

    if (hash1 === hash2)
      throw new Error("Different keys should produce different hashes");
  });

  it("should support API key statuses", () => {
    if (
      !ApiKeyStatus.ACTIVE ||
      !ApiKeyStatus.ROTATED ||
      !ApiKeyStatus.REVOKED ||
      !ApiKeyStatus.EXPIRED
    ) {
      throw new Error("Missing API key statuses");
    }
  });

  it("should support key lifecycle event types", () => {
    if (
      !EventType.API_KEY_CREATED ||
      !EventType.API_KEY_ROTATED ||
      !EventType.API_KEY_REVOKED
    ) {
      throw new Error("Missing API key event types");
    }
  });
});
