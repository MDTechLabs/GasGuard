import {
  IsUrl,
  IsArray,
  IsNumber,
  IsOptional,
  IsEnum,
  ArrayUnique,
  IsString,
  MinLength,
  IsBoolean,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Severity } from './severity.enum';

export class RegisterWebhookDto {
  @IsUrl({ require_tld: false, require_protocol: true })
  url: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsNumber({}, { each: true })
  @Type(() => Number)
  chainIds?: number[] = [];

  @IsOptional()
  @IsEnum(Severity)
  minSeverity?: Severity = Severity.WARNING;

  /** Optional pre-shared secret for HMAC signing; auto-generated if omitted */
  @IsOptional()
  @IsString()
  @MinLength(16)
  secret?: string;
}

export class UpdateWebhookDto {
  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  url?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsNumber({}, { each: true })
  @Type(() => Number)
  chainIds?: number[];

  @IsOptional()
  @IsEnum(Severity)
  minSeverity?: Severity;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class AlertConfigDto {
  @IsOptional()
  @IsNumber()
  chainId?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  baseFeePercentageInfo?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  baseFeePercentageWarning?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(200)
  baseFeePercentageCritical?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  absoluteGweiInfo?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  absoluteGweiWarning?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  absoluteGweiCritical?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  volatilityInfo?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  volatilityWarning?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  volatilityCritical?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  priorityFeePercentageInfo?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  priorityFeePercentageWarning?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  priorityFeePercentageCritical?: number;
}
