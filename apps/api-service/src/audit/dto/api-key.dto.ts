import {
  IsString,
  IsOptional,
  IsInt,
  IsEnum,
  Min,
  Max,
  IsUUID,
} from "class-validator";
import { ApiKeyStatus } from "../entities/api-key.entity";

/**
 * DTO for creating a new API key
 */
export class CreateApiKeyDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(365)
  expiresInDays?: number;

  @IsString()
  @IsOptional()
  role?: string;
}

/**
 * DTO for API key response (includes the actual key - only shown once)
 */
export class ApiKeyResponseDto {
  id: string;
  name: string;
  apiKey?: string; // Only present on creation/rotation
  keyHash: string;
  status: ApiKeyStatus;
  expiresAt: Date;
  createdAt: Date;
  lastUsedAt?: Date;
  requestCount: number;
  description?: string;
  role: string;
  rotatedFromId?: string;
  gracePeriodEndsAt?: Date; // For rotated keys
}

/**
 * DTO for API key status response
 */
export class ApiKeyStatusDto {
  id: string;
  name: string;
  status: ApiKeyStatus;
  expiresAt: Date;
  createdAt: Date;
  lastUsedAt?: Date;
  requestCount: number;
  description?: string;
  role: string;
  rotatedFromId?: string;
  isExpired: boolean;
  daysUntilExpiry: number;
}

/**
 * DTO for rotating an API key
 */
export class RotateApiKeyDto {
  @IsString()
  @IsOptional()
  reason?: string;
}

/**
 * DTO for revoking an API key
 */
export class RevokeApiKeyDto {
  @IsString()
  @IsOptional()
  reason?: string;
}

/**
 * DTO for listing API keys with pagination
 */
export class ListApiKeysQueryDto {
  @IsInt()
  @IsOptional()
  @Min(1)
  limit?: number = 50;

  @IsInt()
  @IsOptional()
  @Min(0)
  offset?: number = 0;

  @IsEnum(ApiKeyStatus)
  @IsOptional()
  status?: ApiKeyStatus;
}

/**
 * DTO for paginated API key list response
 */
export class ApiKeyListResponseDto {
  data: ApiKeyStatusDto[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * DTO for API key rotation response
 */
export class ApiKeyRotationResponseDto {
  id: string;
  name: string;
  apiKey: string; // New key (only shown once)
  expiresAt: Date;
  oldKeyId: string;
  oldKeyGracePeriodEndsAt: Date;
}

/**
 * API Key Expired Error Response
 */
export interface ApiKeyExpiredError {
  error: "APIKeyExpired";
  message: string;
  expiredAt: string;
  keyId: string;
}
