import { Test, TestingModule } from "@nestjs/testing";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { AuthModule } from "../auth.module";
import { JwtStrategy } from "../strategies/jwt.strategy";
import { JwtAuthGuard } from "../guards/jwt-auth.guard";
import { RolesGuard } from "../guards/roles.guard";

describe("AuthModule", () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              JWT_SECRET: "test-secret-key-that-is-at-least-32-characters-long",
              JWT_ISSUER: "test-issuer",
              JWT_AUDIENCE: "test-audience",
            }),
          ],
        }),
        AuthModule,
      ],
    }).compile();
  });

  afterEach(async () => {
    await module.close();
  });

  it("should compile the module", () => {
    expect(module).toBeDefined();
  });

  it("should provide JwtStrategy", () => {
    const strategy = module.get<JwtStrategy>(JwtStrategy);
    expect(strategy).toBeDefined();
  });

  it("should provide JwtAuthGuard", () => {
    const guard = module.get<JwtAuthGuard>(JwtAuthGuard);
    expect(guard).toBeDefined();
  });

  it("should provide RolesGuard", () => {
    const guard = module.get<RolesGuard>(RolesGuard);
    expect(guard).toBeDefined();
  });

  it("should export JwtAuthGuard", async () => {
    // Test that JwtAuthGuard can be imported from the module
    const exportedGuard = module.get(JwtAuthGuard);
    expect(exportedGuard).toBeInstanceOf(JwtAuthGuard);
  });

  it("should export RolesGuard", async () => {
    const exportedGuard = module.get(RolesGuard);
    expect(exportedGuard).toBeInstanceOf(RolesGuard);
  });

  it("should export PassportModule", () => {
    const passportModule = module.get(PassportModule);
    expect(passportModule).toBeDefined();
  });

  it("should export JwtModule", () => {
    const jwtModule = module.get(JwtModule);
    expect(jwtModule).toBeDefined();
  });

  describe("JWT Configuration", () => {
    it("should configure JWT with secret from ConfigService", () => {
      const configService = module.get<ConfigService>(ConfigService);
      const secret = configService.get<string>("JWT_SECRET");

      expect(secret).toBe(
        "test-secret-key-that-is-at-least-32-characters-long",
      );
    });

    it("should configure JWT with issuer from ConfigService", () => {
      const configService = module.get<ConfigService>(ConfigService);
      const issuer = configService.get<string>("JWT_ISSUER");

      expect(issuer).toBe("test-issuer");
    });

    it("should configure JWT with audience from ConfigService", () => {
      const configService = module.get<ConfigService>(ConfigService);
      const audience = configService.get<string>("JWT_AUDIENCE");

      expect(audience).toBe("test-audience");
    });
  });

  describe("Module Metadata", () => {
    it("should have PassportModule as import", () => {
      const passportModule = module.get(PassportModule);
      expect(passportModule).toBeDefined();
    });

    it("should have JwtModule as import", () => {
      const jwtModule = module.get(JwtModule);
      expect(jwtModule).toBeDefined();
    });
  });
});

describe("AuthModule without JWT_SECRET", () => {
  it("should throw error when JWT_SECRET is not configured", async () => {
    await expect(
      Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            load: [() => ({})], // Empty config
          }),
          AuthModule,
        ],
      }).compile(),
    ).rejects.toThrow("JWT_SECRET environment variable is required");
  });
});
