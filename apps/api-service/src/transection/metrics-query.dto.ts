import {
  IsOptional,
  IsString,
  IsEnum,
  IsNumber,
  Min,
  Max,
  Matches,
} from "class-validator";
import { Type } from "class-transformer";
import { TxType } from "../transaction.entity";

export enum Granularity {
  DAILY = "daily",
  MONTHLY = "monthly",
}

export class MetricsQueryDto {
  /** YYYY-MM or YYYY-MM-DD */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}(-\d{2})?$/, {
    message: "period must be YYYY-MM or YYYY-MM-DD",
  })
  period?: string;

  @IsOptional()
  @IsEnum(TxType)
  type?: TxType;
}

export class TimeSeriesQueryDto extends MetricsQueryDto {
  @IsOptional()
  @IsEnum(Granularity)
  granularity?: Granularity = Granularity.DAILY;
}

export class AlertQueryDto extends MetricsQueryDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  threshold?: number = 95;
}
