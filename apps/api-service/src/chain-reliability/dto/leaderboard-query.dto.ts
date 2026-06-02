import { IsEnum, IsOptional, IsInt, Min, Max } from "class-validator";
import { MetricTimeWindow } from "../entities/chain-performance-metric.entity";

export class LeaderboardQueryDto {
  @IsEnum(MetricTimeWindow)
  timeWindow: MetricTimeWindow = MetricTimeWindow.DAILY;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}

export class ChainPerformanceQueryDto {
  @IsEnum(MetricTimeWindow)
  timeWindow: MetricTimeWindow = MetricTimeWindow.WEEKLY;
}

export class CompareChainsQueryDto {
  @IsEnum(MetricTimeWindow)
  timeWindow: MetricTimeWindow = MetricTimeWindow.WEEKLY;
}
