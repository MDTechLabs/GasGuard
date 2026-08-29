
import { Injectable } from '@nestjs/common';
import { GasOracleNetworkConfig } from './gas-oracle-network-config.interface';

@Injectable()
export class NetworkConfigService {
    private readonly networks: GasOracleNetworkConfig[] = [
        {
            chainId: 'ethereum-mainnet',
            chainName: 'Ethereum Mainnet',
            rpcUrl: process.env.GAS_ORACLE_ETHEREUM_MAINNET_RPC_URL,
            nativeToken: 'ethereum',
        },
        {
            chainId: 'stellar-mainnet',
            chainName: 'Stellar Mainnet',
            rpcUrl: process.env.GAS_ORACLE_STELLAR_MAINNET_RPC_URL,
            nativeToken: 'stellar',
        },
        {
            chainId: 'optimism-mainnet',
            chainName: 'Optimism Mainnet',
            rpcUrl: process.env.GAS_ORACLE_OPTIMISM_MAINNET_RPC_URL,
            nativeToken: 'optimism',
        },
        {
            chainId: 'arbitrum-mainnet',
            chainName: 'Arbitrum Mainnet',
            rpcUrl: process.env.GAS_ORACLE_ARBITRUM_MAINnet_RPC_URL,
            nativeToken: 'arbitrum',
        },
        {
            chainId: 'polygon-mainnet',
            chainName: 'Polygon Mainnet',
            rpcUrl: process.env.GAS_ORACLE_POLYGON_MAINNET_RPC_URL,
            nativeToken: 'matic-network',
        },
        {
            chainId: 'avalanche-mainnet',
            chainName: 'Avalanche Mainnet',
            rpcUrl: process.env.GAS_ORACLE_AVALANCHE_MAINNET_RPC_URL,
            nativeToken: 'avalanche-2',
        },
        {
            chainId: 'bnb-chain-mainnet',
            chainName: 'BNB Chain Mainnet',
            rpcUrl: process.env.GAS_ORACLE_BNB_CHAIN_MAINNET_RPC_URL,
            nativeToken: 'binancecoin',
        },
    ];

    getSupportedNetworks(): GasOracleNetworkConfig[] {
        return [...this.networks];
    }

    getSupportedChainIds(): string[] {
        return this.networks.map((network) => network.chainId);
    }

    getNetworkConfig(chainId: string): GasOracleNetworkConfig {
        const network = this.networks.find(
            (candidate) => candidate.chainId === chainId,
        );

        if (!network) {
            throw new Error(`Unsupported chainId: ${chainId}`);
        }

        return network;
    }
}