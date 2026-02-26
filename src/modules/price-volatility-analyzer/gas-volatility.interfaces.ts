export interface RawGasData {
  chainId: number;
  blockNumber: string;
  baseFee: string; // wei
  priorityFee: string; // wei
  gasUsed: string;
  gasLimit: string;
  timestamp: Date;
}

export interface TimeSeries {
  timestamp: Date;
  gasPriceGwei: number;
}

export interface VolatilityMetrics {
  stdDeviation: number;
  sma24h: number;
  ema24h: number;
  shortLongRatio: number;
  currentVolatilityIndex: number;
  rolling7d: number;
  sampleSize: number;
}

export interface ChainVolatilityResult {
  chainId: number;
  currentVolatilityIndex: number;
  volatilityLevel: 'Low' | 'Moderate' | 'High' | 'Extreme';
  rolling7d: number;
  recommendation: string;
}

export interface GasDataProvider {
  fetchLatestGasData(chainId: number): Promise<RawGasData>;
  fetchHistoricalGasData(
    chainId: number,
    from: Date,
    to: Date,
  ): Promise<RawGasData[]>;
}

export const GAS_DATA_PROVIDER = Symbol('GAS_DATA_PROVIDER');
export const SUPPORTED_CHAINS = Symbol('SUPPORTED_CHAINS');
