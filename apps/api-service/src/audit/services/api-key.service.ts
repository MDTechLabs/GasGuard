import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  ForbiddenException,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import { ApiKeyRepository } from "./api-key.repository";
import { AuditLogService } from "./audit-log.service";
import { ApiKey, ApiKeyStatus } from "../entities/api-key.entity";
import { EventType } from "../entities/audit-log.entity";
import {
  CreateApiKeyDto,
  ApiKeyResponseDto,
  ApiKeyStatusDto,
  ApiKeyListResponseDto,
  ApiKeyRotationResponseDto,
} from "../dto/api-key.dto";

export class ApiKeyExpiredException extends HttpException {
  constructor(expiredAt: Date, keyId: string) {
    super(
      {
        error: "APIKeyExpired",
        message:
          "This API key has expired. Please rotate or request a new key.",
        expiredAt: expiredAt.toISOString(),
        keyId,
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}

export class ApiKeyRevokedException extends HttpException {
  constructor(keyId: string) {
    super(
      {
        error: "APIKeyRevoked",
        message: "This API key has been revoked.",
        keyId,
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}

@Injectable()
export class ApiKeyService {
  private readonly defaultExpiryDays: number;
  private readonly rotationGracePeriodHours: number;
  private readonly keyPrefix: string;

  constructor(
    private readonly apiKeyRepository: ApiKeyRepository,
    private readonly auditLogService: AuditLogService,
    private readonly configService: ConfigService,
  ) {
    this.defaultExpiryDays = this.configService.get<number>(
      "API_KEY_DEFAULT_EXPIRY_DAYS",
      90,
    );
    this.rotationGracePeriodHours = this.configService.get<number>(
      "API_KEY_ROTATION_GRACE_PERIOD_HOURS",
      24,
    );
    this.keyPrefix = this.configService.get<string>("API_KEY_PREFIX", "gg");
  }

  /**
   * Generate a cryptographically secure API key
   */
  private generateApiKey(): { rawKey: string; keyHash: string } {
    const randomPart = crypto.randomBytes(32).toString("base64url");
    const rawKey = `${this.keyPrefix}_${randomPart}`;
    const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
    return { rawKey, keyHash };
  }

  /**
   * Hash an existing API key
   */
  hashApiKey(rawKey: string): string {
    return crypto.createHash("sha256").update(rawKey).digest("hex");
  }

  /**
   * Calculate expiry date based on days from now
   */
  private calculateExpiryDate(days: number): Date {
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + days);
    return expiryDate;
  }

  /**
   * Check if a key is expired
   */
  private isExpired(apiKey: ApiKey): boolean {
    if (!apiKey.expiresAt) return false;
    return new Date() > apiKey.expiresAt;
  }

  /**
   * Calculate days until expiry
   */
  private getDaysUntilExpiry(expiresAt: Date): number {
    const now = new Date();
    const diffTime = expiresAt.getTime() - now.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  /**
   * Create a new API key
   */
  async createApiKey(
    merchantId: string,
    createDto: CreateApiKeyDto,
  ): Promise<ApiKeyResponseDto> {
    const { rawKey, keyHash } = this.generateApiKey();
    const expiresInDays = createDto.expiresInDays || this.defaultExpiryDays;
    const expiresAt = this.calculateExpiryDate(expiresInDays);

    const apiKey = await this.apiKeyRepository.createApiKey({
      merchantId,
      name: createDto.name,
      description: createDto.description,
      keyHash,
      status: ApiKeyStatus.ACTIVE,
      expiresAt,
      role: createDto.role || "user",
      requestCount: 0,
    });

    // Emit audit event
    this.auditLogService.emitApiKeyEvent(
      EventType.API_KEY_CREATED,
      merchantId,
      {
        keyId: apiKey.id,
        name: apiKey.name,
        role: apiKey.role,
        expiresAt: apiKey.expiresAt,
      },
    );

    return {
      id: apiKey.id,
      name: apiKey.name,
      apiKey: rawKey, // Only shown once
      keyHash: apiKey.keyHash,
      status: apiKey.status,
      expiresAt: apiKey.expiresAt,
      createdAt: apiKey.createdAt,
      lastUsedAt: apiKey.lastUsedAt,
      requestCount: apiKey.requestCount,
      description: apiKey.description,
      role: apiKey.role,
    };
  }

  /**
   * Validate an API key
   */
  async validateApiKey(rawKey: string): Promise<ApiKey> {
    const keyHash = this.hashApiKey(rawKey);
    const apiKey = await this.apiKeyRepository.findActiveByKeyHash(keyHash);

    if (!apiKey) {
      throw new UnauthorizedException("Invalid API key");
    }

    // Check if expired
    if (this.isExpired(apiKey)) {
      // Mark as expired in database
      await this.apiKeyRepository.updateStatus(apiKey.id, ApiKeyStatus.EXPIRED);

      // Emit audit event
      this.auditLogService.emitApiKeyEvent(
        EventType.API_KEY_REVOKED,
        apiKey.merchantId,
        {
          keyId: apiKey.id,
          reason: "expired",
          expiredAt: apiKey.expiresAt,
        },
      );

      throw new ApiKeyExpiredException(apiKey.expiresAt, apiKey.id);
    }

    // Record usage
    await this.apiKeyRepository.recordUsage(apiKey.id);

    return apiKey;
  }

  /**
   * Get API key status
   */
  async getApiKeyStatus(
    keyId: string,
    merchantId: string,
  ): Promise<ApiKeyStatusDto> {
    const apiKey = await this.apiKeyRepository.findById(keyId);

    if (!apiKey) {
      throw new NotFoundException("API key not found");
    }

    if (apiKey.merchantId !== merchantId) {
      throw new ForbiddenException("You do not have access to this API key");
    }

    const isExpired = this.isExpired(apiKey);
    const daysUntilExpiry = this.getDaysUntilExpiry(apiKey.expiresAt);

    return {
      id: apiKey.id,
      name: apiKey.name,
      status: isExpired ? ApiKeyStatus.EXPIRED : apiKey.status,
      expiresAt: apiKey.expiresAt,
      createdAt: apiKey.createdAt,
      lastUsedAt: apiKey.lastUsedAt,
      requestCount: apiKey.requestCount,
      description: apiKey.description,
      role: apiKey.role,
      rotatedFromId: apiKey.rotatedFromId,
      isExpired,
      daysUntilExpiry: Math.max(0, daysUntilExpiry),
    };
  }

  /**
   * List all API keys for a merchant
   */
  async listApiKeys(
    merchantId: string,
    limit: number = 50,
    offset: number = 0,
    status?: ApiKeyStatus,
  ): Promise<ApiKeyListResponseDto> {
    const { data, total } = await this.apiKeyRepository.findByMerchantId(
      merchantId,
      limit,
      offset,
      status,
    );

    const apiKeyStatuses: ApiKeyStatusDto[] = data.map((apiKey) => {
      const isExpired = this.isExpired(apiKey);
      const daysUntilExpiry = this.getDaysUntilExpiry(apiKey.expiresAt);

      return {
        id: apiKey.id,
        name: apiKey.name,
        status: isExpired ? ApiKeyStatus.EXPIRED : apiKey.status,
        expiresAt: apiKey.expiresAt,
        createdAt: apiKey.createdAt,
        lastUsedAt: apiKey.lastUsedAt,
        requestCount: apiKey.requestCount,
        description: apiKey.description,
        role: apiKey.role,
        rotatedFromId: apiKey.rotatedFromId,
        isExpired,
        daysUntilExpiry: Math.max(0, daysUntilExpiry),
      };
    });

    return {
      data: apiKeyStatuses,
      total,
      limit,
      offset,
    };
  }

  /**
   * Rotate an API key
   */
  async rotateApiKey(
    keyId: string,
    merchantId: string,
    reason?: string,
  ): Promise<ApiKeyRotationResponseDto> {
    const oldKey = await this.apiKeyRepository.findById(keyId);

    if (!oldKey) {
      throw new NotFoundException("API key not found");
    }

    if (oldKey.merchantId !== merchantId) {
      throw new ForbiddenException("You do not have access to this API key");
    }

    if (oldKey.status === ApiKeyStatus.REVOKED) {
      throw new ForbiddenException("Cannot rotate a revoked API key");
    }

    // Generate new key
    const { rawKey: newRawKey, keyHash: newKeyHash } = this.generateApiKey();
    const expiresAt = this.calculateExpiryDate(this.defaultExpiryDays);

    // Create new key with reference to old key
    const newKey = await this.apiKeyRepository.createApiKey({
      merchantId,
      name: oldKey.name,
      description: oldKey.description,
      keyHash: newKeyHash,
      status: ApiKeyStatus.ACTIVE,
      expiresAt,
      role: oldKey.role,
      requestCount: 0,
      rotatedFromId: oldKey.id,
    });

    // Mark old key as ROTATED (not revoked - grace period applies)
    await this.apiKeyRepository.updateStatus(oldKey.id, ApiKeyStatus.ROTATED);

    // Calculate grace period end
    const oldKeyGracePeriodEndsAt = new Date();
    oldKeyGracePeriodEndsAt.setHours(
      oldKeyGracePeriodEndsAt.getHours() + this.rotationGracePeriodHours,
    );

    // Emit audit event
    this.auditLogService.emitApiKeyEvent(
      EventType.API_KEY_ROTATED,
      merchantId,
      {
        oldKeyId: oldKey.id,
        newKeyId: newKey.id,
        reason: reason || "user-initiated",
        gracePeriodEndsAt: oldKeyGracePeriodEndsAt,
      },
    );

    return {
      id: newKey.id,
      name: newKey.name,
      apiKey: newRawKey, // Only shown once
      expiresAt: newKey.expiresAt,
      oldKeyId: oldKey.id,
      oldKeyGracePeriodEndsAt,
    };
  }

  /**
   * Revoke an API key
   */
  async revokeApiKey(
    keyId: string,
    merchantId: string,
    reason?: string,
  ): Promise<void> {
    const apiKey = await this.apiKeyRepository.findById(keyId);

    if (!apiKey) {
      throw new NotFoundException("API key not found");
    }

    if (apiKey.merchantId !== merchantId) {
      throw new ForbiddenException("You do not have access to this API key");
    }

    if (apiKey.status === ApiKeyStatus.REVOKED) {
      throw new ForbiddenException("API key is already revoked");
    }

    await this.apiKeyRepository.updateStatus(keyId, ApiKeyStatus.REVOKED);

    // Emit audit event
    this.auditLogService.emitApiKeyEvent(
      EventType.API_KEY_REVOKED,
      merchantId,
      {
        revokedKeyId: keyId,
        reason: reason || "user-initiated",
      },
    );
  }

  /**
   * Process expired keys (called by scheduled job)
   */
  async processExpiredKeys(): Promise<number> {
    const expiredKeys = await this.apiKeyRepository.findExpiredKeys();

    for (const key of expiredKeys) {
      await this.apiKeyRepository.updateStatus(key.id, ApiKeyStatus.EXPIRED);

      // Emit audit event
      this.auditLogService.emitApiKeyEvent(
        EventType.API_KEY_REVOKED,
        key.merchantId,
        {
          keyId: key.id,
          reason: "expired",
          expiredAt: key.expiresAt,
        },
      );
    }

    return expiredKeys.length;
  }

  /**
   * Clean up keys past their grace period (called by scheduled job)
   */
  async cleanupRotatedKeys(): Promise<number> {
    const keysToRevoke = await this.apiKeyRepository.findKeysPastGracePeriod(
      this.rotationGracePeriodHours,
    );

    for (const key of keysToRevoke) {
      await this.apiKeyRepository.updateStatus(key.id, ApiKeyStatus.REVOKED);

      // Emit audit event
      this.auditLogService.emitApiKeyEvent(
        EventType.API_KEY_REVOKED,
        key.merchantId,
        {
          keyId: key.id,
          reason: "grace-period-ended",
          rotatedFromId: key.rotatedFromId,
        },
      );
    }

    return keysToRevoke.length;
  }

  /**
   * Get keys expiring soon (for notifications)
   */
  async getKeysExpiringSoon(days: number): Promise<ApiKey[]> {
    return this.apiKeyRepository.findKeysExpiringWithinDays(days);
  }
}
