import { Controller, Get, Post, Query, Body, Param } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { GasSavingsDto, DashboardQueryDto } from './dto/gas-savings.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';

@ApiTags('analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Get comprehensive dashboard data' })
  @ApiQuery({ name: 'projectId', required: false, description: 'Filter by project ID' })
  @ApiResponse({ status: 200, description: 'Dashboard data retrieved successfully' })
  async getDashboard(@Query() query: DashboardQueryDto) {
    return this.analyticsService.getDashboardData(query.projectId);
  }

  @Get('savings/total')
  @ApiOperation({ summary: 'Get total gas savings across all scans' })
  @ApiResponse({ status: 200, description: 'Total savings retrieved successfully' })
  async getTotalSavings() {
    const total = await this.analyticsService.getTotalSavings();
    return { totalSavings: total };
  }

  @Get('savings/projects')
  @ApiOperation({ summary: 'Get gas savings aggregated by project' })
  @ApiResponse({ status: 200, description: 'Project savings retrieved successfully' })
  async getSavingsByProject() {
    return this.analyticsService.getSavingsByProject();
  }

  @Get('savings/projects/:projectId/files')
  @ApiOperation({ summary: 'Get gas savings by file for a specific project' })
  @ApiResponse({ status: 200, description: 'File savings retrieved successfully' })
  async getSavingsByFile(@Param('projectId') projectId: string) {
    return this.analyticsService.getSavingsByFile(projectId);
  }

  @Get('savings/rules')
  @ApiOperation({ summary: 'Get gas savings aggregated by rule' })
  @ApiQuery({ name: 'projectId', required: false, description: 'Filter by project ID' })
  @ApiResponse({ status: 200, description: 'Rule savings retrieved successfully' })
  async getSavingsByRule(@Query('projectId') projectId?: string) {
    return this.analyticsService.getSavingsByRule(projectId);
  }

  @Get('savings/timeseries')
  @ApiOperation({ summary: 'Get gas savings time series data' })
  @ApiQuery({ name: 'projectId', required: false, description: 'Filter by project ID' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Start date (ISO string)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'End date (ISO string)' })
  @ApiQuery({ name: 'granularity', required: false, enum: ['hour', 'day', 'week', 'month'], description: 'Time granularity' })
  @ApiResponse({ status: 200, description: 'Time series data retrieved successfully' })
  async getSavingsTimeSeries(
    @Query('projectId') projectId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('granularity') granularity: 'hour' | 'day' | 'week' | 'month' = 'day'
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    return this.analyticsService.getSavingsTimeSeries(projectId, start, end, granularity);
  }

  @Get('savings/severity')
  @ApiOperation({ summary: 'Get gas savings by severity level' })
  @ApiQuery({ name: 'projectId', required: false, description: 'Filter by project ID' })
  @ApiResponse({ status: 200, description: 'Severity savings retrieved successfully' })
  async getSavingsBySeverity(@Query('projectId') projectId?: string) {
    return this.analyticsService.getSavingsBySeverity(projectId);
  }

  @Get('optimizations/top')
  @ApiOperation({ summary: 'Get top optimization opportunities' })
  @ApiQuery({ name: 'projectId', required: false, description: 'Filter by project ID' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Number of results to return' })
  @ApiResponse({ status: 200, description: 'Top optimizations retrieved successfully' })
  async getTopOptimizations(
    @Query('projectId') projectId?: string,
    @Query('limit') limit: number = 10
  ) {
    return this.analyticsService.getTopOptimizations(projectId, limit);
  }

  @Post('savings')
  @ApiOperation({ summary: 'Record gas savings from a scan' })
  @ApiResponse({ status: 201, description: 'Gas savings recorded successfully' })
  async recordGasSavings(@Body() savings: GasSavingsDto[]) {
    return this.analyticsService.recordGasSavings(savings);
  }
}
