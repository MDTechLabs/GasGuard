/**
 * Redis connection health metrics (#1094).
 *
 * The queue, rate limiter and cache all depend on Redis, so a degraded
 * connection must be visible before jobs start failing. This collector tracks
 * lifecycle transitions and command latency, and exposes a snapshot suitable
 * for a health endpoint or a Prometheus gauge.
 *
 * Notable distinction: `isHealthy` reports false while the client is
 * reconnecting, because a pool that has never connected is not healthy even
 * though it has not yet errored.
 */

export type RedisConnectionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export interface RedisLatencySummary {
  samples: number;
  averageMs: number;
  maxMs: number;
  p50Ms: number;
  p95Ms: number;
}

export interface RedisHealthSnapshot {
  state: RedisConnectionState;
  /** Lifetime successful connections. */
  totalConnects: number;
  /** Lifetime disconnects, including drops. */
  totalDisconnects: number;
  errorCount: number;
  lastErrorAt?: number;
  lastError?: string;
  latency: RedisLatencySummary;
}

const DEFAULT_MAX_SAMPLES = 256;

export class RedisHealthMetrics {
  private state: RedisConnectionState = "connecting";
  private totalConnects = 0;
  private totalDisconnects = 0;
  private errorCount = 0;
  private lastErrorAt?: number;
  private lastError?: string;
  private readonly latencySamples: number[] = [];
  private readonly maxSamples: number;

  constructor(maxSamples: number = DEFAULT_MAX_SAMPLES) {
    if (!Number.isInteger(maxSamples) || maxSamples <= 0) {
      throw new RangeError("maxSamples must be a positive integer");
    }
    this.maxSamples = maxSamples;
  }

  onConnect(): void {
    this.state = "connected";
    this.totalConnects += 1;
  }

  onConnecting(): void {
    this.state = "connecting";
  }

  onDisconnect(): void {
    this.state = "disconnected";
    this.totalDisconnects += 1;
  }

  onError(error: unknown, now: number = Date.now()): void {
    this.state = "error";
    this.errorCount += 1;
    this.lastErrorAt = now;
    this.lastError =
      error instanceof Error ? error.message : typeof error === "string" ? error : "unknown redis error";
  }

  /** Record the wall-clock duration of one successful command. */
  recordCommandLatency(durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new RangeError("durationMs must be a non-negative number");
    }
    this.latencySamples.push(durationMs);
    if (this.latencySamples.length > this.maxSamples) {
      this.latencySamples.shift();
    }
  }

  isHealthy(): boolean {
    return this.state === "connected";
  }

  snapshot(): RedisHealthSnapshot {
    return {
      state: this.state,
      totalConnects: this.totalConnects,
      totalDisconnects: this.totalDisconnects,
      errorCount: this.errorCount,
      ...(this.lastErrorAt === undefined ? {} : { lastErrorAt: this.lastErrorAt }),
      ...(this.lastError === undefined ? {} : { lastError: this.lastError }),
      latency: summarizeLatency(this.latencySamples),
    };
  }
}

function summarizeLatency(samples: readonly number[]): RedisLatencySummary {
  if (samples.length === 0) {
    return { samples: 0, averageMs: 0, maxMs: 0, p50Ms: 0, p95Ms: 0 };
  }

  const sorted = [...samples].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);

  return {
    samples: sorted.length,
    averageMs: total / sorted.length,
    maxMs: sorted[sorted.length - 1],
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
  };
}

function percentile(sorted: readonly number[], quantile: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil(quantile * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}
