  @Get('v1/analytics/rpc-health')
  @ApiOperation({
    summary: 'Get RPC provider health status',
    description: 'Returns health metrics for all RPC providers per chain.'
  })
  @ApiResponse({
    status: 200,
    description: 'RPC provider health status returned successfully'
  })
  async getRpcHealthStatus(): Promise<Record<number, any>> {
    return this.crossChainGasService.getRpcHealthStatus();
  }
import { Controller, Get, Query, BadRequestException, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { CrossChainGasService } from '../services/cross-chain-gas.service';
import { 
  CrossChainGasRequest, 
  CrossChainGasResponse,
  SupportedChain 
} from '../schemas/cross-chain-gas.schema';
import { Public, Roles, Role, JwtAuthGuard, RolesGuard } from '../auth';

@ApiTags('Cross-Chain Gas Comparison')
@ApiBearerAuth()
@Controller()
export class CrossChainGasController {
  constructor(private readonly crossChainGasService: CrossChainGasService) {}

  @Get('v1/analytics/cross-chain-gas')
  @ApiOperation({ 
    summary: 'Compare gas costs across supported chains',
    description: 'Get real-time gas cost comparison across all supported chains, normalized to USD and ranked by efficiency'
  })
  @ApiQuery({ 
    name: 'txType', 
    enum: ['transfer', 'contract-call', 'swap'],
    required: true,
    description: 'Type of transaction to compare costs for'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Cross-chain gas comparison retrieved successfully'
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Invalid transaction type provided'
  })
  async getCrossChainGasComparison(
    @Query('txType') txType: string
  ): Promise<CrossChainGasResponse> {
    if (!['transfer', 'contract-call', 'swap'].includes(txType)) {
      throw new BadRequestException('Invalid transaction type. Must be one of: transfer, contract-call, swap');
    }

    const request: CrossChainGasRequest = {
      txType: txType as 'transfer' | 'contract-call' | 'swap'
    };

    return this.crossChainGasService.getCrossChainGasComparison(request);
  }

  @Get('v1/analytics/supported-chains')
  @ApiOperation({ 
    summary: 'Get list of supported chains',
    description: 'Retrieve all supported chains with their metadata and configuration'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Supported chains retrieved successfully'
  })
  async getSupportedChains(): Promise<SupportedChain[]> {
    return this.crossChainGasService.getSupportedChains();
  }

  @Roles(Role.ADMIN)
  @Get('v1/analytics/cross-chain-gas/refresh')
  @ApiOperation({ 
    summary: 'Refresh gas price data',
    description: 'Force refresh of gas price data and native token prices (admin endpoint). Requires admin role.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Gas price data refreshed successfully'
  })
  @ApiResponse({ 
    status: 403, 
    description: 'Forbidden - Requires admin role'
  })
  async refreshGasData(): Promise<{ message: string; timestamp: number }> {
    await this.crossChainGasService.updateNativeTokenPrices();
    return {
      message: 'Gas price data refreshed successfully',
      timestamp: Date.now()
    };
  }

  @Get('v1/analytics/cross-chain-gas/history')
  @ApiOperation({ 
    summary: 'Get historical gas price data',
    description: 'Retrieve historical gas price data for a specific chain'
  })
  @ApiQuery({ 
    name: 'chainId', 
    type: 'number',
    required: true,
    description: 'Chain ID to fetch historical data for'
  })
  @ApiQuery({ 
    name: 'hours', 
    type: 'number',
    required: false,
    description: 'Number of hours of historical data to fetch (default: 24)'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Historical gas data retrieved successfully'
  })
  async getGasHistory(
    @Query('chainId') chainId: number,
    @Query('hours') hours?: number
  ): Promise<any[]> {
    if (!chainId || isNaN(chainId)) {
      throw new BadRequestException('Valid chain ID is required');
    }

    return this.crossChainGasService.getChainGasMetricsHistory(chainId, hours);
  }
}
