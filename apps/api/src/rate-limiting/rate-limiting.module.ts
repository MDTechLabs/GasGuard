/**
 * Rate Limiting Module
 *
 * NestJS module that provides rate limiting capabilities including
 * Redis service, rate limit service, guard, and admin controller.
 */

import { Module, Global, DynamicModule } from "@nestjs/common";
import { RateLimitService } from "./services/rate-limit.service";
import { RedisService } from "./services/redis.service";
import { RateLimitGuard } from "./guards/rate-limit.guard";
import { RateLimitAdminController } from "./controllers/admin.controller";
import { RateLimitConfig, rateLimitConfig } from "./config/rate-limit.config";

export interface RateLimitingModuleOptions {
  config?: Partial<RateLimitConfig>;
}

@Global()
@Module({})
export class RateLimitingModule {
  /**
   * Register the rate limiting module with default configuration
   */
  static forRoot(options: RateLimitingModuleOptions = {}): DynamicModule {
    const defaultConfig = rateLimitConfig();
    const config: RateLimitConfig = {
      ...defaultConfig,
      ...options.config,
      redis: {
        ...defaultConfig.redis,
        ...options.config?.redis,
      },
    };

    return {
      module: RateLimitingModule,
      controllers: [RateLimitAdminController],
      providers: [
        {
          provide: "RATE_LIMIT_CONFIG",
          useValue: config,
        },
        RedisService,
        RateLimitService,
        RateLimitGuard,
      ],
      exports: [RateLimitService, RateLimitGuard, RedisService],
    };
  }

  /**
   * Register the rate limiting module asynchronously
   */
  static forRootAsync(options: {
    useFactory: (
      ...args: any[]
    ) => Promise<Partial<RateLimitConfig>> | Partial<RateLimitConfig>;
    inject?: any[];
  }): DynamicModule {
    return {
      module: RateLimitingModule,
      controllers: [RateLimitAdminController],
      providers: [
        {
          provide: "RATE_LIMIT_CONFIG",
          useFactory: async (...args: any[]) => {
            const defaultConfig = rateLimitConfig();
            const customConfig = await options.useFactory(...args);
            return {
              ...defaultConfig,
              ...customConfig,
              redis: {
                ...defaultConfig.redis,
                ...customConfig?.redis,
              },
            };
          },
          inject: options.inject || [],
        },
        RedisService,
        RateLimitService,
        RateLimitGuard,
      ],
      exports: [RateLimitService, RateLimitGuard, RedisService],
    };
  }
}
