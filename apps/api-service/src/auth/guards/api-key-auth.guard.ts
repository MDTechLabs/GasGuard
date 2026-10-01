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
 * Privilege boundary documentation for API key authentication.
 *
 * Trust boundaries:
 * - This guard operates at the HTTP edge of the api-service. It authenticates the caller and establishes the
 *   merchant principal for the request. It does NOT authorize access to specific resources or perform
 *   business-level authorization. Downstream guards and services MUST enforce merchant-scoped access using
 *   the attached `principal` and `merchantId`.
 * - API keys are credentials that grant the full scope of the owning merchant. They MUST NOT be used to
   implicitly grant administrative, internal, or cross-merchant privileges. Administrative operations
   require a separate privileged authentication path (e.g., admin tokens or mutual TLS) and MUST NOT
   accept merchant API keys.
 * - The guard attaches only non-secret metadata to the request. The raw API key MUST NOT be logged,
 *   echoed, returned in errors, or persisted in downstream components.
 * - Error messages are deliberately generic to avoid leaking whether a key exists or is revoked.
 *
 * Secure defaults:
 * - Absence of a credential results in denied-by-default for `ApiKeyAuthGuard`.
 * - `OptionalApiKeyAuthGuard` never elevates privileges: an invalid key is ignored and no principal is
 *   attached, so downstream guards must still enforce authorization.
 */

/**
 * Guard to authenticate requests using API keys
 * Supports extraction from:
 * - Authorization header: Bearer <api-key>
 * - X-API-Key header
 * - apiKey query parameter
 *
 * Security note: Prefer header-based credentials to query parameters. Query strings are commonly
 * captured in access logs, proxies, and browser history. The query parameter fallback is retained
 * for backward compatibility only and should be disabled in high-security deployments.
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

      // Attach API key info to request for downstream use.
      // Only non-secret metadata is exposed; the raw credential is not persisted on the request.
      request.apiKey = apiKey;
      request.merchantId = apiKey.merchantId;

      return true;
    } catch (error) {
      // Re-throw API key specific errors
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      // Generic error for other cases. The underlying cause is intentionally not surfaced to the
      // caller to avoid leaking whether a key exists or has been revoked.
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
 *
 * Privilege boundary: this guard is non-elevating. It never rejects a request and never attaches a
 * principal when the credential is missing or invalid. Routes that rely on it for security MUST
 * combine it with an explicit authorization check downstream.
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

      // Attach API key info to request for downstream use.
      // Only non-secret metadata is exposed; the raw credential is not persisted on the request.
      request.apiKey = apiKey;
      request.merchantId = apiKey.merchantId;

      return true;
    } catch (error) {
      // Even with invalid key, optional guard allows request through
      // but doesn't attach API key info. No privilege is elevated.
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
