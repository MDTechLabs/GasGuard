export interface ChainGasMetrics {
  chainId: number;
  chainName: string;
  baseFee?: string;
  priorityFee?: string;
  averageGasUsed: {
    transfer: number;
    "contract-call": number;
    swap: number;
  };
  nativeTokenPriceUSD: number;
  averageConfirmationTime: number; // in seconds
}

export interface TransactionCost {
  chainId: number;
  chainName: string;
  estimatedCostUSD: number;
  estimatedCostNative: string;
  averageConfirmationTime: string;
  rank: number;
}

export interface CrossChainGasRequest {
  txType: "transfer" | "contract-call" | "swap";
}

export interface CrossChainGasResponse {
  txType: string;
  timestamp: number;
  chains: TransactionCost[];
}

export interface ChainRanking {
  chainId: number;
  chainName: string;
  totalCostUSD: number;
  totalCostNative: string;
  volatilityScore?: number;
  confirmationSpeed: number;
  rank: number;
}

export interface GasNormalizationResult {
  chainId: number;
  txType: string;
  gasUsed: number;
  effectiveGasPrice: string;
  totalCostNative: string;
  totalCostUSD: number;
}

export interface SupportedChain {
  chainId: number;
  chainName: string;
  nativeToken: string;
  rpcUrl: string;
  blockTime: number; // average block time in seconds
}
