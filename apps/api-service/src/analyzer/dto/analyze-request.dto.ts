import { IsString, IsNotEmpty, IsOptional, IsObject, IsIn, IsInt, Min, IsArray, ValidateNested, IsBoolean } from "class-validator";
import { Type } from "class-transformer";

export const POLICY_SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type PolicySeverity = (typeof POLICY_SEVERITIES)[number];

/**
 * A single policy-as-code rule. A build fails when any finding matches the
 * rule's criteria (severity, rule id, path prefix) and the optional count
 * threshold is reached.
 */
export class PolicyRuleDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsIn(POLICY_SEVERITIES as unknown as string[])
  severity?: PolicySeverity;

  @IsOptional()
  @IsString()
  ruleId?: string;

  @IsOptional()
  @IsString()
  pathPrefix?: string;

  /** Fail when the number of matching findings is >= this value (default 1). */
  @IsOptional()
  @IsInt()
  @Min(1)
  maxFindings?: number = 1;
}

/**
 * Policy configuration that controls whether a scan result should fail a build.
 */
export class PolicyConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean = true;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PolicyRuleDto)
  rules?: PolicyRuleDto[] = [];
}

export class AnalyzeRequestDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsOptional()
  source?: string = "remote-analysis";

  /** Optional policy-as-code configuration evaluated against the analysis findings. */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PolicyConfigDto)
  policy?: PolicyConfigDto;
}
