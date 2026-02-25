import { IsString, IsOptional, IsEnum, IsInt, IsNumber, Min, Max } from 'class-validator';
import { SeverityLevel, PatternStatus, PatternType } from '../entities/suspicious-gas-pattern.entity';

/**
 * DTO for querying suspicious gas patterns
 */
export class QuerySuspiciousGasDto {
  @IsInt()
  @IsOptional()
  chainId?: number;

  @IsEnum(SeverityLevel)
  @IsOptional()
  severity?: SeverityLevel;

  @IsEnum(PatternStatus)
  @IsOptional()
  status?: PatternStatus;

  @IsString()
  @IsOptional()
  from?: string; // ISO date string

  @IsString()
  @IsOptional()
  to?: string; // ISO date string

  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @IsInt()
  @IsOptional()
  @Min(0)
  offset?: number = 0;
}

/**
 * DTO for reviewing a suspicious gas pattern
 */
export class ReviewPatternDto {
  @IsString()
  reviewerId: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

/**
 * DTO for clearing a false positive pattern
 */
export class ClearPatternDto {
  @IsString()
  reviewerId: string;

  @IsString()
  reason: string;
}

/**
 * DTO for confirming abuse
 */
export class ConfirmAbuseDto {
  @IsString()
  reviewerId: string;

  @IsString()
  @IsOptional()
  action?: string; // e.g., 'throttle', 'block', 'monitor'

  @IsString()
  @IsOptional()
  notes?: string;
}

/**
 * Response DTO for suspicious gas pattern
 */
export class SuspiciousGasPatternResponseDto {
  id: string;
  accountAddress: string;
  chainId: number;
  severity: SeverityLevel;
  patternType: PatternType;
  description: string;
  flaggedTransactions: number;
  abnormalGasTotal: string;
  baselineGasUsed: string;
  deviationScore: number;
  firstDetectedAt: Date;
  lastDetectedAt: Date;
  status: PatternStatus;
  reviewedBy?: string;
  reviewedAt?: Date;
  reviewNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Response DTO for paginated list
 */
export class SuspiciousGasPatternListResponseDto {
  data: SuspiciousGasPatternResponseDto[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Response DTO for statistics
 */
export class SuspiciousGasStatsResponseDto {
  totalFlags: number;
  bySeverity: {
    low: number;
    medium: number;
    high: number;
  };
  byStatus: {
    active: number;
    reviewed: number;
    cleared: number;
    confirmed_abuse: number;
  };
  byChain: Record<string, number>;
  recentDetections: number; // Last 24 hours
}

/**
 * Webhook payload for suspicious gas alerts
 */
export interface SuspiciousGasAlertPayload {
  chainId: number;
  account: string;
  severity: string;
  patternType: string;
  flaggedTransactions: number;
  abnormalGasTotal: string;
  timestamp: number;
  recommendation: string;
}
