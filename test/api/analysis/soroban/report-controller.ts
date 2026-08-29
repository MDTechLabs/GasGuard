import { Controller, Get, Query, Logger, UseGuards } from '@nestjs/common';
import { ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

export interface SorobanReportFilterQuery {
  contractPath?: string;
  severity?: 'high' | 'medium' | 'low';
  page?: number;
  limit?: number;
}

export interface SorobanAnalysisReportDto {
  contractPath: string;
  findings: Array<{
    ruleId: string;
    severity: string;
    message: string;
    recommendation: string;
    confidenceScore: number;
    location: { line: number; column?: number };
  }>;
  resourceEstimates: {
    cpuInstructions: number;
    memoryBytes: number;
    storageCostStroops: number;
  };
  regressionResult: {
    hasRegressed: boolean;
    cpuDelta: number;
  };
}

@ApiTags('Soroban Optimization Reports')
@Controller('api/v1/analysis/soroban')
export class SorobanOptimizationReportController {
  private readonly logger = new Logger(SorobanOptimizationReportController.name);

  @Get('reports')
  @ApiQuery({ name: 'contractPath', required: false, type: String })
  @ApiQuery({ name: 'severity', required: false, enum: ['high', 'medium', 'low'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Successfully retrieved paginated Soroban optimization reports.' })
  public getReports(@Query() query: SorobanReportFilterQuery): { data: SorobanAnalysisReportDto[]; total: number; page: number; limit: number } {
    this.logger.debug(`Fetching Soroban optimization reports with filters: ${JSON.stringify(query)}`);

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    // Mock dataset representing stored analysis outputs
    const allReports: SorobanAnalysisReportDto[] = [
      {
        contractPath: 'contracts/vault.rs',
        findings: [
          {
            ruleId: 'SOROBAN-STOR-01',
            severity: 'high',
            message: 'Frequent storage write detected inside a loop.',
            recommendation: 'Batch state modifications outside the loop.',
            confidenceScore: 0.95,
            location: { line: 42 },
          },
        ],
        resourceEstimates: {
          cpuInstructions: 125000,
          memoryBytes: 4096,
          storageCostStroops: 2500,
        },
        regressionResult: {
          hasRegressed: true,
          cpuDelta: 15000,
        },
      },
    ];

    let filtered = allReports;
    if (query.contractPath) {
      filtered = filtered.filter(r => r.contractPath.includes(query.contractPath!));
    }
    if (query.severity) {
      filtered = filtered.filter(r => r.findings.some(f => f.severity === query.severity));
    }

    const startIndex = (page - 1) * limit;
    const paginatedData = filtered.slice(startIndex, startIndex + limit);

    return {
      data: paginatedData,
      total: filtered.length,
      page,
      limit,
    };
  }
}