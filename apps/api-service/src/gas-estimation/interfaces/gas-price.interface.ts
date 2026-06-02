/**
 * Gas Price Interface
 * Defines the structure for dynamic gas pricing
 */

export interface GasPriceSnapshot {
  id: string;
  chainId: string;
  chainName: string;
  timestamp: Date;
  baseFeePerInstruction: number; // stroops per instruction
  surgePriceMultiplier: number; // 1.0 = base, > 1.0 = congestion
  recommendedFeeRate: number; // stroops per instruction (final price)
  networkLoad: number; // 0-100 percentage
  memoryPoolSize: number; // bytes
  transactionCount: number; // count in recent block
  averageBlockTime: number; // ms
  volatilityIndex: number; // 0-100, higher = more volatile
  priceConfidence: number; // 0-100, higher = more confident
}

export interface DynamicGasEstimate {
  transactionHash?: string;
  chainId: string;
  estimatedGasUnits: number;
  baseGasPrice: number; // stroops per instruction
  surgeMultiplier: number;
  dynamicGasPrice: number; // stroops per instruction (base * surge)
  totalEstimatedCostStroops: number;
  totalEstimatedCostXLM: number;
  priceValidityDurationMs: number; // how long this price is valid
  expiresAt: Date;
  recommendedPriority: "low" | "normal" | "high" | "critical";
  alternativePrices?: {
    low: number;
    medium: number;
    high: number;
  };
}

export interface NetworkMetrics {
  congestionLevel: number; // 0-100
  gasPoolUtilization: number; // 0-100
  averageTransactionTime: number; // ms
  pendingTransactionCount: number;
  lastBlockGasUsed: number;
  lastBlockGasLimit: number;
  historicalAverageGasPrice: number;
  priceVolatility: number; // standard deviation
}

export interface GasPriceHistory {
  timestamp: Date;
  basePrice: number;
  surgeMultiplier: number;
  effectivePrice: number;
  networkLoad: number;
}

export interface PricingStrategy {
  name: string;
  baseMultiplier: number;
  congestionThresholds: {
    low: number;
    medium: number;
    high: number;
  };
  surgeMultipliers: {
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
  safetyMargin: number; // 1.1 = 10% safety margin
}
