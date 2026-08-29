import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { UnauthorizedException } from "@nestjs/common";
import { JwtStrategy, JwtPayload } from "../strategies/jwt.strategy";

describe("JwtStrategy", () => {
  let strategy: JwtStrategy;
  let configService: ConfigService;

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    mockConfigService.get.mockImplementation(
      (key: string, defaultValue?: any) => {
        const config: Record<string, any> = {
          JWT_SECRET: "test-secret-key-that-is-at-least-32-characters-long",
          JWT_ISSUER: "test-issuer",
          JWT_AUDIENCE: "test-audience",
        };
        return config[key] ?? defaultValue;
      },
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("constructor", () => {
    it("should throw error if JWT_SECRET is not set", () => {
      mockConfigService.get.mockReturnValue(undefined);

      expect(() => {
        new JwtStrategy(configService);
      }).toThrow("JWT_SECRET environment variable is required");
    });

    it("should use default issuer and audience if not configured", () => {
      mockConfigService.get.mockImplementation(
        (key: string, defaultValue?: any) => {
          if (key === "JWT_SECRET")
            return "test-secret-key-that-is-at-least-32-characters-long";
          return defaultValue;
        },
      );

      const testStrategy = new JwtStrategy(configService);
      expect(testStrategy).toBeDefined();
    });
  });

  describe("validate", () => {
    const validPayload: JwtPayload = {
      sub: "user-123",
      iss: "test-issuer",
      aud: "test-audience",
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      roles: ["user", "analyst"],
      permissions: ["read:transactions", "write:transactions"],
    };

    it("should validate a valid payload and return user", async () => {
      const result = await strategy.validate(validPayload);

      expect(result).toEqual({
        userId: "user-123",
        roles: ["user", "analyst"],
        permissions: ["read:transactions", "write:transactions"],
      });
    });

    it("should validate payload with empty roles and permissions", async () => {
      const payloadWithoutRoles: JwtPayload = {
        sub: "user-123",
        iss: "test-issuer",
        aud: "test-audience",
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      };

      const result = await strategy.validate(payloadWithoutRoles);

      expect(result).toEqual({
        userId: "user-123",
        roles: [],
        permissions: [],
      });
    });

    it("should throw UnauthorizedException if sub claim is missing", async () => {
      const invalidPayload = { ...validPayload, sub: undefined as any };

      await expect(strategy.validate(invalidPayload)).rejects.toThrow(
        new UnauthorizedException("Invalid token: missing subject claim"),
      );
    });

    it("should throw UnauthorizedException if iss claim is missing", async () => {
      const invalidPayload = { ...validPayload, iss: undefined as any };

      await expect(strategy.validate(invalidPayload)).rejects.toThrow(
        new UnauthorizedException("Invalid token: missing issuer claim"),
      );
    });

    it("should throw UnauthorizedException if aud claim is missing", async () => {
      const invalidPayload = { ...validPayload, aud: undefined as any };

      await expect(strategy.validate(invalidPayload)).rejects.toThrow(
        new UnauthorizedException("Invalid token: missing audience claim"),
      );
    });

    it("should throw UnauthorizedException if exp claim is missing", async () => {
      const invalidPayload = { ...validPayload, exp: undefined as any };

      await expect(strategy.validate(invalidPayload)).rejects.toThrow(
        new UnauthorizedException("Invalid token: missing expiration claim"),
      );
    });

    it("should throw UnauthorizedException if token is expired", async () => {
      const expiredPayload: JwtPayload = {
        ...validPayload,
        exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
      };

      await expect(strategy.validate(expiredPayload)).rejects.toThrow(
        new UnauthorizedException("Token has expired"),
      );
    });

    it("should reject token that expired in the past", async () => {
      const expiredPayload: JwtPayload = {
        ...validPayload,
        exp: Math.floor(Date.now() / 1000) - 1, // 1 second ago
      };

      await expect(strategy.validate(expiredPayload)).rejects.toThrow(
        new UnauthorizedException("Token has expired"),
      );
    });
  });
});
