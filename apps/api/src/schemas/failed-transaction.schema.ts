export interface FailedTransaction {
  id: string;
  hash: string;
  wallet: string;
  chainId: number;
  blockNumber?: number;
  gasUsed: string;
  gasPrice: string;
  effectiveFee: string;
  failureCategory: FailureCategory;
  revertReason?: string;
  timestamp: string;
  metadata: TransactionMetadata;
}

export interface TransactionMetadata {
  nonce: number;
  to?: string;
  value?: string;
  data?: string;
  gasLimit: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  transactionType: "legacy" | "eip1559" | "eip2930";
}

export type FailureCategory =
  | "underpriced_gas"
  | "out_of_gas"
  | "contract_revert"
  | "slippage_exceeded"
  | "nonce_conflict"
  | "insufficient_balance"
  | "network_error"
  | "unknown";

export interface FailureAnalysis {
  wallet: string;
  totalFailures: number;
  totalGasWasted: string;
  totalGasWastedUSD?: number;
  failureCategories: Record<FailureCategory, number>;
  topFailureCategory: FailureCategory;
  recommendations: MitigationRecommendation[];
  timeframe: {
    start: string;
    end: string;
  };
  chainBreakdown: Record<number, ChainFailureStats>;
}

export interface ChainFailureStats {
  chainId: number;
  failures: number;
  gasWasted: string;
  mostCommonCategory: FailureCategory;
}

export interface MitigationRecommendation {
  id: string;
  category: FailureCategory;
  priority: "low" | "medium" | "high";
  title: string;
  description: string;
  action: string;
  estimatedImpact: string;
  parameters?: Record<string, any>;
}

export interface TransactionAnalysisRequest {
  wallet: string;
  chainIds?: number[];
  timeframe?: {
    start?: string;
    end?: string;
  };
  includeRecommendations?: boolean;
}

export interface TransactionAnalysisResponse {
  wallet: string;
  analysis: FailureAnalysis;
  processedAt: string;
  requestId?: string;
}

export interface FailedTransactionEvent {
  type: "transaction_failed";
  data: FailedTransaction;
  timestamp: string;
}

export interface CostMetrics {
  totalGasWasted: string;
  totalGasWastedUSD: number;
  averageWastePerFailure: string;
  wasteByCategory: Record<FailureCategory, string>;
  wasteByChain: Record<number, string>;
  historicalTrend: {
    date: string;
    waste: string;
    failures: number;
  }[];
}

export interface RootCauseAnalysis {
  category: FailureCategory;
  confidence: number;
  evidence: string[];
  patterns: {
    gasUsage?: {
      used: string;
      limit: string;
      utilization: number;
    };
    pricing?: {
      gasPrice: string;
      networkGasPrice: string;
      deviation: number;
    };
    timing?: {
      blockTime: number;
      congestion: "low" | "medium" | "high";
    };
  };
}
