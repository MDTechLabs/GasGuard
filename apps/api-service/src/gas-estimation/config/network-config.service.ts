import { Injectable } from "@nestjs/common";

export interface GasEstimationNetworkConfig {
  chainId: string;
  chainName: string;
  rpcUrl?: string;
  baseFeePerInstruction: number;
  historicalAverageGasPrice: number;
  defaultBlockGasLimit: number;
  baselineLoad: number;
  averageBlockTimeMs: number;
}

@Injectable()
export class NetworkConfigService {
  private readonly networks: GasEstimationNetworkConfig[] = [
    {
      chainId: "soroban-mainnet",
      chainName: "Soroban Mainnet",
      rpcUrl:
        process.env.GAS_ESTIMATION_SOROBAN_MAINNET_RPC_URL ||
        process.env.GAS_ESTIMATION_SOROBAN_RPC_URL,
      baseFeePerInstruction: 1000,
      historicalAverageGasPrice: 1000,
      defaultBlockGasLimit: 100000000,
      baselineLoad: 40,
      averageBlockTimeMs: 4000,
    },
    {
      chainId: "soroban-testnet",
      chainName: "Soroban Testnet",
      rpcUrl:
        process.env.GAS_ESTIMATION_SOROBAN_TESTNET_RPC_URL ||
        process.env.GAS_ESTIMATION_SOROBAN_RPC_URL,
      baseFeePerInstruction: 1000,
      historicalAverageGasPrice: 1000,
      defaultBlockGasLimit: 100000000,
      baselineLoad: 30,
      averageBlockTimeMs: 4500,
    },
  ];

  getSupportedNetworks(): GasEstimationNetworkConfig[] {
    return [...this.networks];
  }

  getSupportedChainIds(): string[] {
    return this.networks.map((network) => network.chainId);
  }

  getNetworkConfig(chainId: string): GasEstimationNetworkConfig {
    const network = this.networks.find(
      (candidate) => candidate.chainId === chainId,
    );

    if (!network) {
      throw new Error(`Unsupported chainId: ${chainId}`);
    }

    return network;
  }
}
