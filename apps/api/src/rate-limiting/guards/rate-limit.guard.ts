/**
 * Rate Limit Guard
 *
 * NestJS guard that enforces rate limits on incoming requests.
 * Extracts API key from X-API-Key header and applies rate limiting checks.
 * Sets standard rate limit headers on responses.
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
  Inject,
} from "@nestjs/common";
import { Request, Response } from "express";
import { RateLimitService } from "../services/rate-limit.service";
import { RedisService } from "../services/redis.service";
import { RateLimitConfig } from "../config/rate-limit.config";
import { RATE_LIMIT_HEADERS } from "../schemas/rate-limit.schema";

interface RequestWithApiKey extends Request {
  apiKey?: string;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly rateLimitService: RateLimitService,
    private readonly redisService: RedisService,
    @Inject("RATE_LIMIT_CONFIG")
    private readonly config: RateLimitConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithApiKey>();
    const response = context.switchToHttp().getResponse<Response>();

    // Extract API key from header
    const apiKey = this.extractApiKey(request);

    if (!apiKey) {
      // No API key provided - reject in strict mode, allow in permissive
      if (this.config.fallbackMode === "strict") {
        throw new HttpException(
          {
            error: "Missing API Key",
            message: "X-API-Key header is required",
          },
          HttpStatus.UNAUTHORIZED,
        );
      }

      // In permissive mode, allow but don't track
      this.setHeaders(response, {
        limit: Infinity,
        remaining: Infinity,
        resetTime: 0,
      });
      return true;
    }

    // Store API key on request for later use
    request.apiKey = apiKey;

    // Check Redis availability
    if (!this.redisService.isReady()) {
      this.logger.warn("Redis unavailable, applying fallback mode");

      if (this.config.fallbackMode === "strict") {
        throw new HttpException(
          {
            error: "Service Unavailable",
            message: "Rate limiting service temporarily unavailable",
          },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }

      // Permissive mode: allow request but log
      this.logger.warn(`Rate limit check bypassed for API key: ${apiKey}`);
      this.setHeaders(response, {
        limit: Infinity,
        remaining: Infinity,
        resetTime: 0,
      });
      return true;
    }

    // Check rate limit
    const status = await this.rateLimitService.checkLimit(apiKey);

    // Set rate limit headers
    this.setHeaders(response, {
      limit: status.limit,
      remaining: Math.max(0, status.remaining),
      resetTime: status.resetTime,
    });

    if (!status.allowed) {
      const retryAfter = status.resetTime - Math.floor(Date.now() / 1000);

      throw new HttpException(
        {
          error: "Rate limit exceeded",
          message: `You have exceeded your request quota for the ${status.window} window. Try again in ${retryAfter} seconds.`,
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Increment counter for successful requests
    await this.rateLimitService.incrementCounter(apiKey);

    return true;
  }

  /**
   * Extract API key from request headers
   */
  private extractApiKey(request: Request): string | null {
    // Check X-API-Key header (primary)
    const apiKey = request.headers["x-api-key"];
    if (apiKey && typeof apiKey === "string") {
      return apiKey.trim();
    }

    // Check Authorization header as fallback (Bearer token format)
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      return authHeader.substring(7).trim();
    }

    return null;
  }

  /**
   * Set rate limit headers on response
   */
  private setHeaders(
    response: Response,
    params: { limit: number; remaining: number; resetTime: number },
  ): void {
    response.setHeader(RATE_LIMIT_HEADERS.limit, params.limit.toString());
    response.setHeader(
      RATE_LIMIT_HEADERS.remaining,
      params.remaining.toString(),
    );
    response.setHeader(RATE_LIMIT_HEADERS.reset, params.resetTime.toString());
  }
}
