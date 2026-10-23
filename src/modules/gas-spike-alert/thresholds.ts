import { Severity, SpikeType } from './severity.enum';

export interface SeverityBand {
  min: number;
  max: number;
  severity: Severity;
  recommendation: string;
}

export const DEFAULT_THRESHOLDS = {
  /** Base fee % increase within the monitoring window */
  BASE_FEE_PERCENTAGE: {
    INFO: 15,      // ≥15% → Info
    WARNING: 30,   // ≥30% → Warning
    CRITICAL: 40,  // ≥40% → Critical
  },

  /** Absolute base fee in gwei */
  ABSOLUTE_GWEI: {
    INFO: 50,
    WARNING: 80,
    CRITICAL: 100,
  },

  /** Volatility index (0–1 scale) */
  VOLATILITY_INDEX: {
    INFO: 0.40,
    WARNING: 0.60,
    CRITICAL: 0.75,
  },

  /** Priority fee % increase within the monitoring window */
  PRIORITY_FEE_PERCENTAGE: {
    INFO: 30,
    WARNING: 70,
    CRITICAL: 100, // doubles
  },
} as const;

export const RECOMMENDATIONS: Record<Severity, string> = {
  [Severity.INFO]:
    'Monitor gas prices closely. Minor fluctuation detected.',
  [Severity.WARNING]:
    'Consider delaying non-urgent transactions or use dynamic gas pricing.',
  [Severity.CRITICAL]:
    'Pause automated transactions or switch to High tier pricing.',
};

/** How many historical data points to include in the moving average */
export const MOVING_AVERAGE_WINDOW = 10;

/** Monitoring poll interval in milliseconds (30 s default) */
export const MONITOR_INTERVAL_MS = 30_000;

/** Maximum number of data points kept per chain */
export const MAX_HISTORY_POINTS = 100;

/** Webhook dispatch retry attempts */
export const WEBHOOK_MAX_RETRIES = 3;

/** Base back-off delay in ms for failed webhook calls */
export const WEBHOOK_BACKOFF_BASE_MS = 1_000;

/** HMAC algorithm used for webhook signatures */
export const WEBHOOK_HMAC_ALGO = 'sha256';
