import { MetricTimeWindow } from "../entities/chain-performance-metric.entity";

export interface ChainMetrics {
  chainId: string;
  chainName: string;
  network: string;
}

export interface TransactionMetrics {
  totalTransactions: number;
  successfulTransactions: number;
  failedTransactions: number;
  successRate: number;
}

export interface GasMetrics {
  averageGasPrice: number;
  minGasPrice: number;
  maxGasPrice: number;
  gasPriceVolatility: number;
  averageTransactionFee: number;
}

export interface NetworkMetrics {
  averageLatency: number;
  latencyVolatility: number;
  networkCongestionScore: number;
}

export interface ReliabilityScores {
  stabilityScore: number;
  costEfficiencyScore: number;
  overallReliabilityScore: number;
}

export interface ChainPerformanceData {
  chainId: string;
  chainName: string;
  network: string;
  transactionMetrics: TransactionMetrics;
  gasMetrics: GasMetrics;
  networkMetrics: NetworkMetrics;
  reliabilityScores: ReliabilityScores;
  recordedAt: Date;
}

export interface LeaderboardEntry {
  rank: number;
  chainId: string;
  chainName: string;
  network: string;
  reliabilityScore: number;
  stabilityScore: number;
  costEfficiencyScore: number;
  successRate: number;
  averageGasPrice: number;
  networkCongestionScore: number;
}

export interface LeaderboardQuery {
  timeWindow: MetricTimeWindow;
  network?: string;
  limit?: number;
}

export interface MetricsCollectionOptions {
  chainIds?: string[];
  timeWindow: MetricTimeWindow;
  startDate: Date;
  endDate: Date;
}
