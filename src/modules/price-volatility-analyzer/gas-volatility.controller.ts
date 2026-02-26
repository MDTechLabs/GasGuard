import {
  Controller,
  Get,
  Query,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { GasVolatilityService } from './gas-volatility.service';
import { GasDataAggregationService } from './gas-data-aggregation.service';
import {
  GetVolatilityQueryDto,
  VolatilityResponseDto,
  ChainComparisonResponseDto,
  HistoricalVolatilityResponseDto,
} from './dto/gas-volatility.dto';

@ApiTags('Gas Volatility')
@Controller('gas-volatility')
export class GasVolatilityController {
  constructor(
    private readonly volatilityService: GasVolatilityService,
    private readonly aggregationService: GasDataAggregationService,
  ) {}

  /**
   * GET /gas-volatility?chainId=1
   * Returns the current volatility index and recommendation for a chain.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get current gas price volatility for a chain' })
  @ApiResponse({ status: 200, type: VolatilityResponseDto })
  @ApiResponse({ status: 404, description: 'Chain not supported' })
  async getVolatility(
    @Query() query: GetVolatilityQueryDto,
  ): Promise<VolatilityResponseDto> {
    return this.volatilityService.getVolatility(query.chainId);
  }

  /**
   * GET /gas-volatility/compare
   * Returns side-by-side volatility for all supported chains.
   */
  @Get('compare')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Compare gas volatility across all supported chains' })
  @ApiResponse({ status: 200, type: ChainComparisonResponseDto })
  async compareChains(): Promise<ChainComparisonResponseDto> {
    return this.volatilityService.getChainComparison();
  }

  /**
   * GET /gas-volatility/history?chainId=1&days=7
   */
  @Get('history')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get historical volatility snapshots for a chain' })
  @ApiQuery({ name: 'chainId', type: Number, required: true })
  @ApiQuery({ name: 'days', type: Number, required: false, example: 7 })
  @ApiResponse({ status: 200, type: HistoricalVolatilityResponseDto })
  async getHistory(
    @Query() query: GetVolatilityQueryDto,
    @Query('days') days = 7,
  ): Promise<HistoricalVolatilityResponseDto> {
    return this.volatilityService.getHistoricalVolatility(query.chainId, Number(days));
  }

  /**
   * POST /gas-volatility/ingest
   * Manually trigger gas data ingestion for a chain (admin use / cron fallback).
   */
  @Post('ingest')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually ingest latest gas data for a chain' })
  @ApiQuery({ name: 'chainId', type: Number, required: true })
  @ApiResponse({ status: 200, description: 'Ingestion triggered successfully' })
  async ingestLatest(
    @Query() query: GetVolatilityQueryDto,
  ): Promise<{ message: string }> {
    await this.aggregationService.ingestLatest(query.chainId);
    return { message: `Gas data ingested for chain ${query.chainId}` };
  }
}
