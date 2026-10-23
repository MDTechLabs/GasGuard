import { Severity, SpikeType } from './severity.enum';

/** Raw gas price snapshot fetched per chain */
export interface GasSnapshot {
  chainId: number;
  baseFeeGwei: number;
  priorityFeeGwei: number;
  timestamp: number; // Unix seconds
}

/** Enriched snapshot that includes derived metrics */
export interface EnrichedSnapshot extends GasSnapshot {
  movingAverageBaseFee: number;
  movingAveragePriorityFee: number;
  volatilityIndex: number;
  baseFeePercentageChange: number;
  priorityFeePercentageChange: number;
}

/** A single threshold rule evaluation result */
export interface ThresholdResult {
  triggered: boolean;
  spikeType: SpikeType;
  severity: Severity;
  value: number;        // The measured value
  threshold: number;   // The threshold that was crossed
  percentageIncrease?: number;
}

/** Outbound webhook alert payload */
export interface AlertPayload {
  chainId: number;
  severity: Severity;
  spikeTypes: SpikeType[];
  previousBaseFee: string;       // human-readable, e.g. "32 gwei"
  currentBaseFee: string;
  previousPriorityFee: string;
  currentPriorityFee: string;
  percentageIncrease: number;    // base fee %
  volatilityIndex: number;
  timestamp: number;
  recommendation: string;
}

/** Stored webhook subscription */
export interface WebhookSubscription {
  id: string;
  url: string;
  chainIds: number[];            // empty = all chains
  minSeverity: Severity;
  secret: string;                // used for HMAC signature
  createdAt: number;
  active: boolean;
}

/** Custom threshold overrides a user can supply */
export interface CustomThresholdConfig {
  chainId?: number;
  baseFeePercentageInfo?: number;
  baseFeePercentageWarning?: number;
  baseFeePercentageCritical?: number;
  absoluteGweiInfo?: number;
  absoluteGweiWarning?: number;
  absoluteGweiCritical?: number;
  volatilityInfo?: number;
  volatilityWarning?: number;
  volatilityCritical?: number;
  priorityFeePercentageInfo?: number;
  priorityFeePercentageWarning?: number;
  priorityFeePercentageCritical?: number;
}
