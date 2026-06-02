export enum StellarNetworkStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNHEALTHY = 'unhealthy',
}

export enum StellarRpcEndpointStatus {
  UP = 'up',
  DOWN = 'down',
  TIMEOUT = 'timeout',
}

export interface StellarRpcEndpointHealth {
  /** The RPC endpoint URL */
  url: string;
  /** Current availability status */
  status: StellarRpcEndpointStatus;
  /** Round-trip latency in milliseconds, null if unreachable */
  latencyMs: number | null;
  /** Timestamp of the last successful probe */
  lastCheckedAt: string;
  /** Number of consecutive failures since last success */
  consecutiveFailures: number;
  /** Error message from the last failed probe, if any */
  lastError: string | null;
}

export interface StellarNetworkMetrics {
  /** Overall network health status */
  status: StellarNetworkStatus;
  /** Number of healthy endpoints */
  healthyEndpoints: number;
  /** Total number of configured endpoints */
  totalEndpoints: number;
  /** Average latency across all healthy endpoints in ms */
  averageLatencyMs: number | null;
  /** Minimum latency observed across healthy endpoints in ms */
  minLatencyMs: number | null;
  /** Maximum latency observed across healthy endpoints in ms */
  maxLatencyMs: number | null;
  /** Per-endpoint health details */
  endpoints: StellarRpcEndpointHealth[];
  /** ISO timestamp of the last metrics collection */
  collectedAt: string;
  /** Total number of probes performed since service start */
  totalProbes: number;
  /** Total number of failed probes since service start */
  totalFailedProbes: number;
  /** Uptime percentage over the monitoring window (0–100) */
  uptimePercentage: number;
}

export interface StellarHealthCheckResponse {
  status: StellarNetworkStatus;
  service: string;
  timestamp: string;
  metrics: StellarNetworkMetrics;
}
