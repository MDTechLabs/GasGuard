import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ApiKeyService } from "../../audit/services/api-key.service";
import { ApiKey } from "../../audit/entities/api-key.entity";

/**
 * Interface for request with API key authentication
 */
export interface ApiKeyRequest {
  apiKey: ApiKey;
  merchantId: string;
  [key: string]: any;
}

/**
 * Guard to authenticate requests using API keys
 * Supports extraction from:
 * - Authorization header: Bearer <api-key>
 * - X-API-Key header
 * - apiKey query parameter
 */
@Injectable()
export class ApiKeyAuthGuard {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  async canActivate(context: any): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // Extract API key from request
    const rawApiKey = this.extractApiKey(request);

    if (!rawApiKey) {
      throw new UnauthorizedException(
        "API key is required. Provide it via Authorization header (Bearer), X-API-Key header, or apiKey query parameter.",
      );
    }

    try {
      // Validate the API key
      const apiKey = await this.apiKeyService.validateApiKey(rawApiKey);

      // Attach API key info to request for downstream use
      request.apiKey = apiKey;
      request.merchantId = apiKey.merchantId;

      return true;
    } catch (error) {
      // Re-throw API key specific errors
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      // Generic error for other cases
      throw new UnauthorizedException("Invalid API key");
    }
  }

  /**
   * Extract API key from various sources
   */
  private extractApiKey(request: any): string | null {
    // Check Authorization header (Bearer token)
    const authHeader = request.headers?.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      return authHeader.slice(7);
    }

    // Check X-API-Key header
    const apiKeyHeader = request.headers?.["x-api-key"];
    if (apiKeyHeader) {
      return apiKeyHeader;
    }

    // Check query parameters
    if (request.query?.apiKey) {
      return request.query.apiKey;
    }

    return null;
  }
}

/**
 * Optional API Key Auth Guard
 * Attaches API key info if present, but doesn't require it
 */
@Injectable()
export class OptionalApiKeyAuthGuard {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  async canActivate(context: any): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // Extract API key from request
    const rawApiKey = this.extractApiKey(request);

    if (!rawApiKey) {
      // No API key provided, but that's okay for optional guard
      return true;
    }

    try {
      // Validate the API key
      const apiKey = await this.apiKeyService.validateApiKey(rawApiKey);

      // Attach API key info to request for downstream use
      request.apiKey = apiKey;
      request.merchantId = apiKey.merchantId;

      return true;
    } catch (error) {
      // Even with invalid key, optional guard allows request through
      // but doesn't attach API key info
      return true;
    }
  }

  /**
   * Extract API key from various sources
   */
  private extractApiKey(request: any): string | null {
    // Check Authorization header (Bearer token)
    const authHeader = request.headers?.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      return authHeader.slice(7);
    }

    // Check X-API-Key header
    const apiKeyHeader = request.headers?.["x-api-key"];
    if (apiKeyHeader) {
      return apiKeyHeader;
    }

    // Check query parameters
    if (request.query?.apiKey) {
      return request.query.apiKey;
    }

    return null;
  }
}
