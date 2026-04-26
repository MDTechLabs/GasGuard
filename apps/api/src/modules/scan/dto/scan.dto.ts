import { IsString, IsOptional, IsArray, IsEnum, IsObject, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ScanType {
  SECURITY = 'security',
  GAS = 'gas',
  PERFORMANCE = 'performance',
  FULL = 'full'
}

export enum ScanStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

export class ScanRequestDto {
  @ApiProperty({ description: 'Source code to scan' })
  @IsString()
  code: string;

  @ApiPropertyOptional({ description: 'Language of the code', enum: ['solidity', 'vyper', 'rust', 'javascript', 'typescript'] })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({ description: 'Type of scan to perform', enum: ScanType })
  @IsOptional()
  @IsEnum(ScanType)
  scanType?: ScanType = ScanType.FULL;

  @ApiPropertyOptional({ description: 'File path for context' })
  @IsOptional()
  @IsString()
  filePath?: string;

  @ApiPropertyOptional({ description: 'Specific rules to run' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  rules?: string[];

  @ApiPropertyOptional({ description: 'Custom configuration' })
  @IsOptional()
  @IsObject()
  config?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Severity threshold', minimum: 0, maximum: 100 })
  @IsOptional()
  @Min(0)
  @Max(100)
  severityThreshold?: number;

  @ApiPropertyOptional({ description: 'Maximum number of findings to return' })
  @IsOptional()
  @Min(1)
  @Max(1000)
  maxFindings?: number;
}

export interface FindingDto {
  ruleId: string;
  message: string;
  severity: string;
  location: {
    file: string;
    startLine: number;
    endLine: number;
    startColumn?: number;
    endColumn?: number;
  };
  estimatedGasSavings?: number;
  suggestedFix?: {
    description: string;
    codeSnippet?: string;
    documentationUrl?: string;
  };
  score?: number;
  riskLevel?: string;
}

export interface SummaryDto {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  totalScore?: number;
  riskLevel?: string;
}

export class ScanResponseDto {
  @ApiProperty({ description: 'Unique scan identifier' })
  scanId: string;

  @ApiProperty({ description: 'Scan status', enum: ScanStatus })
  status: ScanStatus;

  @ApiProperty({ description: 'Array of findings' })
  findings: FindingDto[];

  @ApiProperty({ description: 'Analysis summary' })
  summary: SummaryDto;

  @ApiProperty({ description: 'Analysis time in milliseconds' })
  analysisTime: number;

  @ApiProperty({ description: 'Files analyzed' })
  filesAnalyzed: number;

  @ApiPropertyOptional({ description: 'Total estimated gas savings' })
  totalEstimatedGasSavings?: number;

  @ApiPropertyOptional({ description: 'Analyzer version' })
  analyzerVersion?: string;

  @ApiPropertyOptional({ description: 'Errors during analysis' })
  errors?: Array<{
    file: string;
    message: string;
    error?: string;
  }>;

  @ApiProperty({ description: 'Timestamp when scan was completed' })
  timestamp: string;
}

export class ScanStatusDto {
  @ApiProperty({ description: 'Unique scan identifier' })
  scanId: string;

  @ApiProperty({ description: 'Current scan status', enum: ScanStatus })
  status: ScanStatus;

  @ApiPropertyOptional({ description: 'Progress percentage (0-100)' })
  @IsOptional()
  progress?: number;

  @ApiPropertyOptional({ description: 'Current operation being performed' })
  @IsOptional()
  currentOperation?: string;

  @ApiPropertyOptional({ description: 'Estimated time remaining in seconds' })
  @IsOptional()
  estimatedTimeRemaining?: number;

  @ApiProperty({ description: 'Timestamp when status was last updated' })
  lastUpdated: string;

  @ApiProperty({ description: 'Timestamp when scan was started' })
  startedAt: string;

  @ApiPropertyOptional({ description: 'Timestamp when scan was completed' })
  completedAt?: string;

  @ApiPropertyOptional({ description: 'Error message if scan failed' })
  errorMessage?: string;
}

export class QueueStatusDto {
  @ApiProperty({ description: 'Number of jobs in queue' })
  queueLength: number;

  @ApiProperty({ description: 'Number of active scans' })
  activeScans: number;

  @ApiProperty({ description: 'Number of completed scans' })
  completedScans: number;

  @ApiProperty({ description: 'Average processing time in seconds' })
  averageProcessingTime: number;

  @ApiProperty({ description: 'Estimated wait time for new scans in seconds' })
  estimatedWaitTime: number;
}
