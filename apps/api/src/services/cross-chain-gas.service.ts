  public async getRpcHealthStatus(): Promise<Record<number, any>> {
    const status: Record<number, any> = {};
    for (const [chainId, manager] of this.rpcManagers.entries()) {
      await manager.checkHealth();
      status[chainId] = manager.getHealth();
    }
    return status;
  }

  public logFailoverEvent(chainId: number, fromUrl: string, toUrl: string) {
    // Replace with a real logger or audit system as needed
    console.log(`[Failover] Chain ${chainId}: Switched from ${fromUrl} to ${toUrl} at ${new Date().toISOString()}`);
  }

import { Injectable } from '@nestjs/common';
import {
  ChainGasMetrics,
  CrossChainGasRequest,
  CrossChainGasResponse,
  TransactionCost,
  GasNormalizationResult,
  SupportedChain
} from '../schemas/cross-chain-gas.schema';
import { RpcProviderManager, RpcProviderConfig } from './rpc-provider-manager';
import { providers } from 'ethers';

@Injectable()
export class CrossChainGasService {
  private readonly supportedChains: SupportedChain[] = [
    {
      chainId: 1,
      chainName: 'Ethereum',
      nativeToken: 'ETH',
      rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://eth-mainnet.alchemyapi.io/v2/demo',
      blockTime: 12
    },
    {
      chainId: 137,
      chainName: 'Polygon',
      nativeToken: 'MATIC',
      rpcUrl: process.env.POLYGON_RPC_URL || 'https://polygon-mainnet.alchemyapi.io/v2/demo',
      blockTime: 2
    },
    {
      chainId: 56,
      chainName: 'Binance Smart Chain',
      nativeToken: 'BNB',
      rpcUrl: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org',
      blockTime: 3
    },
    {
      chainId: 42161,
      chainName: 'Arbitrum',
      nativeToken: 'ETH',
      rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
      blockTime: 0.5
    },
    {
      chainId: 10,
      chainName: 'Optimism',
      nativeToken: 'ETH',
      rpcUrl: process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io',
      blockTime: 2
    }
  ];

  // Map chainId to RpcProviderManager
  private rpcManagers: Map<number, RpcProviderManager> = new Map();

  constructor() {
    // Example: Add multiple providers per chain (expand as needed)
    const providerConfigs: Record<number, RpcProviderConfig[]> = {
      1: [
        { url: process.env.ETHEREUM_RPC_URL || 'https://eth-mainnet.alchemyapi.io/v2/demo', priority: 1 },
        { url: 'https://rpc.ankr.com/eth', priority: 2 }
      ],
      137: [
        { url: process.env.POLYGON_RPC_URL || 'https://polygon-mainnet.alchemyapi.io/v2/demo', priority: 1 },
        { url: 'https://rpc.ankr.com/polygon', priority: 2 }
      ],
      56: [
        { url: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org', priority: 1 },
        { url: 'https://rpc.ankr.com/bsc', priority: 2 }
      ],
      42161: [
        { url: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc', priority: 1 },
        { url: 'https://rpc.ankr.com/arbitrum', priority: 2 }
      ],
      10: [
        { url: process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io', priority: 1 },
        { url: 'https://rpc.ankr.com/optimism', priority: 2 }
      ]
    };
    for (const chain of this.supportedChains) {
      this.rpcManagers.set(chain.chainId, new RpcProviderManager(chain.chainName, providerConfigs[chain.chainId] || [{ url: chain.rpcUrl, priority: 1 }]));
    }
  }

  private readonly averageGasUsage = {
    transfer: 21000,
    'contract-call': 50000,
    swap: 150000
  };

  private readonly nativeTokenPricesUSD = {
    1: 2000, // ETH
    137: 0.85, // MATIC
    56: 300, // BNB
    42161: 2000, // ETH (Arbitrum)
    10: 2000 // ETH (Optimism)
  };

  async getCrossChainGasComparison(request: CrossChainGasRequest): Promise<CrossChainGasResponse> {
    const chainMetrics = await Promise.all(
      this.supportedChains.map(chain => this.getChainGasMetrics(chain))
    );

    const normalizedCosts = chainMetrics.map(metrics => 
      this.normalizeGasCost(metrics, request.txType)
    );

    const rankedChains = this.rankChainsByCost(normalizedCosts);

    return {
      txType: request.txType,
      timestamp: Date.now(),
      chains: rankedChains
    };
  }

  private async getChainGasMetrics(chain: SupportedChain): Promise<ChainGasMetrics> {
    // Use RpcProviderManager for failover and retry
    const rpcManager = this.rpcManagers.get(chain.chainId)!;
    let provider = rpcManager.getCurrentProvider();
    let baseFee = '0', priorityFee = '0';
    let success = false;
    let attempts = 0;
    const maxAttempts = rpcManager.getProviderUrls().length;
    while (!success && attempts < maxAttempts) {
      try {
        // EIP-1559: baseFeePerGas and maxPriorityFeePerGas
        const block = await provider.getBlock('latest');
        baseFee = block.baseFeePerGas ? block.baseFeePerGas.toString() : '0';
        // Estimate priority fee (could be improved)
        priorityFee = '2000000000';
        success = true;
      } catch (e) {
        // Mark provider unhealthy and failover
        await rpcManager.checkHealth();
        rpcManager.failover();
        provider = rpcManager.getCurrentProvider();
        attempts++;
      }
    }
    return {
      chainId: chain.chainId,
      chainName: chain.chainName,
      baseFee,
      priorityFee,
      averageGasUsed: this.averageGasUsage,
      nativeTokenPriceUSD: (this.nativeTokenPricesUSD as Record<number, number>)[chain.chainId] || 1,
      averageConfirmationTime: chain.blockTime
    };
  }

  private normalizeGasCost(metrics: ChainGasMetrics, txType: string): GasNormalizationResult {
    const gasUsed = metrics.averageGasUsed[txType as keyof typeof metrics.averageGasUsed];
    const baseFee = BigInt(metrics.baseFee || '20000000000');
    const priorityFee = BigInt(metrics.priorityFee || '2000000000');
    const effectiveGasPrice = baseFee + priorityFee;
    
    const totalCostWei = gasUsed * Number(effectiveGasPrice);
    const totalCostNative = (totalCostWei / 1e18).toFixed(6);
    const totalCostUSD = (parseFloat(totalCostNative) * metrics.nativeTokenPriceUSD);

    return {
      chainId: metrics.chainId,
      txType,
      gasUsed,
      effectiveGasPrice: effectiveGasPrice.toString(),
      totalCostNative,
      totalCostUSD
    };
  }

  private rankChainsByCost(costs: GasNormalizationResult[]): TransactionCost[] {
    const sortedCosts = costs.sort((a, b) => a.totalCostUSD - b.totalCostUSD);
    
    return sortedCosts.map((cost, index) => ({
      chainId: cost.chainId,
      chainName: this.getChainName(cost.chainId),
      estimatedCostUSD: cost.totalCostUSD,
      estimatedCostNative: cost.totalCostNative,
      averageConfirmationTime: this.formatConfirmationTime(cost.chainId),
      rank: index + 1
    }));
  }

  private getChainName(chainId: number): string {
    const chain = this.supportedChains.find(c => c.chainId === chainId);
    return chain?.chainName || `Chain ${chainId}`;
  }

  private formatConfirmationTime(chainId: number): string {
    const chain = this.supportedChains.find(c => c.chainId === chainId);
    const seconds = chain?.blockTime || 12;
    
    if (seconds < 1) {
      return `${Math.round(seconds * 1000)}ms`;
    } else if (seconds < 60) {
      return `${Math.round(seconds)} seconds`;
    } else {
      return `${Math.round(seconds / 60)} minutes`;
    }
  }

  async getSupportedChains(): Promise<SupportedChain[]> {
    return this.supportedChains;
  }

  async updateNativeTokenPrices(): Promise<void> {
    // Mock implementation - in production, this would fetch real prices from price oracle
    console.log('Updating native token prices...');
  }

  async getChainGasMetricsHistory(chainId: number, hours: number = 24): Promise<any[]> {
    // Mock implementation - in production, this would fetch historical data
    return [];
  }
}
