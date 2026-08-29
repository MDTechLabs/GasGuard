import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { User } from "../database/entities/user.entity";
import { AuthService } from "./services/auth.service";
import { JwtStrategy } from "./strategies/jwt.strategy";
import {
  ApiKeyAuthGuard,
  OptionalApiKeyAuthGuard,
} from "./guards/api-key-auth.guard";
import { ApiKeyService } from "../audit/services/api-key.service";

/**
 * Authentication Module
 * Provides JWT-based and API Key authentication integrated with RBAC
 */
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: "jwt" }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get(
          "JWT_SECRET",
          "your-secret-key-change-in-production",
        ),
        signOptions: {
          expiresIn: configService.get("JWT_EXPIRES_IN", "24h"),
        },
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([User]),
  ],
  providers: [
    AuthService,
    JwtStrategy,
    ApiKeyAuthGuard,
    OptionalApiKeyAuthGuard,
  ],
  exports: [
    AuthService,
    JwtModule,
    PassportModule,
    ApiKeyAuthGuard,
    OptionalApiKeyAuthGuard,
  ],
})
export class AuthModule {}
