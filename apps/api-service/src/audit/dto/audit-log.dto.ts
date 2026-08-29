import { IsOptional, IsEnum, IsString } from "class-validator";
import { EventType, OutcomeStatus } from "../entities";

export class AuditLogFilterDto {
  @IsOptional()
  @IsEnum(EventType)
  eventType?: EventType;

  @IsOptional()
  @IsString()
  user?: string;

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsEnum(OutcomeStatus)
  outcome?: OutcomeStatus;

  @IsOptional()
  chainId?: number;

  @IsOptional()
  limit?: number = 50;

  @IsOptional()
  offset?: number = 0;

  @IsOptional()
  @IsString()
  sortBy?: string = "timestamp";

  @IsOptional()
  @IsString()
  sortOrder?: "ASC" | "DESC" = "DESC";
}

export class CreateAuditLogDto {
  eventType: string;
  user?: string;
  apiKey?: string;
  chainId?: number;
  details: Record<string, any>;
  outcome: string;
  endpoint?: string;
  httpMethod?: string;
  responseStatus?: number;
  ipAddress?: string;
  errorMessage?: string;
  responseDuration?: number;
}

export class AuditLogResponseDto {
  id: string;
  eventType: string;
  timestamp: Date;
  user?: string;
  apiKey?: string;
  chainId?: number;
  details: Record<string, any>;
  outcome: string;
  endpoint?: string;
  httpMethod?: string;
  responseStatus?: number;
  ipAddress?: string;
  errorMessage?: string;
  responseDuration?: number;
  createdAt: Date;
}

export class AuditLogsPageDto {
  data: AuditLogResponseDto[];
  total: number;
  limit: number;
  offset: number;
}

export class ExportAuditLogsDto {
  format: "csv" | "json";
  eventType?: string;
  user?: string;
  from?: string;
  to?: string;
}
