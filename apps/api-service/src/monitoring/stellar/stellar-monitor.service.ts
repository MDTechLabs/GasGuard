import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import * as http from 'http';
import * as https from 'https';
import {
  StellarNetworkStatus,
  StellarRpcEndpointStatus,
  StellarRpcEndpointHealth,
  StellarNetworkMetrics,
} from './interfaces/stellar-monitor.interface';
import { MonitoringHooksService } from '../../performance-monitoring/services/monitoring-hooks.service';

/** Minimum fraction of healthy endpoints required for HEALTHY status */
const HEALTHY_THRESHOLD = 0.6;

/** Latency above which an endpoint is considered degraded (ms) */
const DEGRADED_LATENCY_MS = 2000;

/** Default probe timeout in milliseconds */
const DEFAULT_TIMEOUT_MS = 5000;

/** Default Stellar RPC endpoints (Horizon + Soroban RPC) */
const DEFAULT_ENDPOINTS = [
  'https://horizon.stellar.org',
  'https://soroban-testnet.stellar.org',
];

/**
 * Monitors Stellar RPC / Horizon endpoint availability and latency.
 *
 * Probes are run on a configurable schedule (default: every 30 seconds).
 * Results are stored in-memory and exposed via {@link getMetrics}.
 * Health counters are also forwarded to {@link MonitoringHooksService} so
 * they appear in the shared `/metrics` snapshot.
 */
@Injectable()
export class StellarMonitorService implements OnModuleInit {
  private readonly logger = new Logger(StellarMonitorService.name);

  /** Mutable per-endpoint state, keyed by URL */
  private readonly endpointState = new Map<string, StellarRpcEndpointHealth>();

  /** Cumulative probe counters */
  private totalProbes = 0;
  private totalFailedProbes = 0;

  /** Probe timeout in ms */
  private readonly timeoutMs: number;

  /** Configured endpoint URLs */
  private readonly endpoints: string[];

  constructor(
    private readonly configService: ConfigService,
    private readonly monitoringHooks: MonitoringHooksService,
  ) {
    this.timeoutMs = this.configService.get<number>(
      'STELLAR_MONITOR_TIMEOUT_MS',
      DEFAULT_TIMEOUT_MS,
    );

    const raw = this.configService.get<string>('STELLAR_RPC_ENDPOINTS', '');
    this.endpoints = raw
      ? raw.split(',').map((u) => u.trim()).filter(Boolean)
      : DEFAULT_ENDPOINTS;

    // Initialise state for every endpoint
    for (const url of this.endpoints) {
      this.endpointState.set(url, {
        url,
        status: StellarRpcEndpointStatus.DOWN,
        latencyMs: null,
        lastCheckedAt: new Date().toISOString(),
        consecutiveFailures: 0,
        lastError: null,
      });
    }
  }

  /** Run an initial probe on startup so metrics are available immediately */
  async onModuleInit(): Promise<void> {
    this.logger.log(
      `Stellar monitor initialised with ${this.endpoints.length} endpoint(s): ${this.endpoints.join(', ')}`,
    );
    await this.probeAll();
  }

  // ─── Scheduled probe ────────────────────────────────────────────────────────

  /** Probe all endpoints every 30 seconds */
  @Cron('*/30 * * * * *')
  async scheduledProbe(): Promise<void> {
    await this.probeAll();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Returns the latest aggregated network metrics.
   * This is a pure read — no network I/O is performed.
   */
  getMetrics(): StellarNetworkMetrics {
    const endpoints = Array.from(this.endpointState.values());
    const healthy = endpoints.filter(
      (e) => e.status === StellarRpcEndpointStatus.UP,
    );

    const latencies = healthy
      .map((e) => e.latencyMs)
      .filter((l): l is number => l !== null);

    const averageLatencyMs =
      latencies.length > 0
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : null;

    const minLatencyMs = latencies.length > 0 ? Math.min(...latencies) : null;
    const maxLatencyMs = latencies.length > 0 ? Math.max(...latencies) : null;

    const uptimePercentage =
      this.totalProbes > 0
        ? Math.round(
            ((this.totalProbes - this.totalFailedProbes) / this.totalProbes) *
              10000,
          ) / 100
        : 100;

    return {
      status: this.deriveNetworkStatus(healthy.length, endpoints.length, averageLatencyMs),
      healthyEndpoints: healthy.length,
      totalEndpoints: endpoints.length,
      averageLatencyMs,
      minLatencyMs,
      maxLatencyMs,
      endpoints,
      collectedAt: new Date().toISOString(),
      totalProbes: this.totalProbes,
      totalFailedProbes: this.totalFailedProbes,
      uptimePercentage,
    };
  }

  /**
   * Manually trigger a probe of all endpoints and return fresh metrics.
   * Useful for on-demand health checks.
   */
  async checkNow(): Promise<StellarNetworkMetrics> {
    await this.probeAll();
    return this.getMetrics();
  }

  // ─── Internal helpers ────────────────────────────────────────────────────────

  /** Probe all configured endpoints concurrently */
  private async probeAll(): Promise<void> {
    await Promise.all(this.endpoints.map((url) => this.probeEndpoint(url)));
    this.emitMetricsToHooks();
  }

  /**
   * Probe a single endpoint with an HTTP HEAD request.
   * Updates the in-memory state for that endpoint.
   */
  private async probeEndpoint(url: string): Promise<void> {
    const current = this.endpointState.get(url)!;
    this.totalProbes++;

    const start = Date.now();
    try {
      await this.httpHead(url, this.timeoutMs);
      const latencyMs = Date.now() - start;

      this.endpointState.set(url, {
        ...current,
        status: StellarRpcEndpointStatus.UP,
        latencyMs,
        lastCheckedAt: new Date().toISOString(),
        consecutiveFailures: 0,
        lastError: null,
      });

      this.logger.debug(`[${url}] UP — ${latencyMs}ms`);
    } catch (err: unknown) {
      this.totalFailedProbes++;
      const errorMessage = err instanceof Error ? err.message : String(err);
      const isTimeout = errorMessage.toLowerCase().includes('timeout');

      this.endpointState.set(url, {
        ...current,
        status: isTimeout
          ? StellarRpcEndpointStatus.TIMEOUT
          : StellarRpcEndpointStatus.DOWN,
        latencyMs: null,
        lastCheckedAt: new Date().toISOString(),
        consecutiveFailures: current.consecutiveFailures + 1,
        lastError: errorMessage,
      });

      this.logger.warn(
        `[${url}] ${isTimeout ? 'TIMEOUT' : 'DOWN'} — ${errorMessage}`,
      );
    }
  }

  /**
   * Perform an HTTP HEAD request and resolve when a response is received,
   * or reject on error / timeout.
   */
  private httpHead(url: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;

      const req = lib.request(
        {
          method: 'HEAD',
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
          path: parsed.pathname || '/',
          timeout: timeoutMs,
        },
        (res) => {
          // Any HTTP response (even 4xx/5xx) means the endpoint is reachable
          res.resume(); // drain the response body
          resolve();
        },
      );

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request timed out after ${timeoutMs}ms`));
      });

      req.on('error', (err) => reject(err));

      req.end();
    });
  }

  /**
   * Derive the overall network status from the fraction of healthy endpoints
   * and the average latency.
   */
  private deriveNetworkStatus(
    healthyCount: number,
    totalCount: number,
    averageLatencyMs: number | null,
  ): StellarNetworkStatus {
    if (totalCount === 0) return StellarNetworkStatus.UNHEALTHY;

    const fraction = healthyCount / totalCount;

    if (fraction === 0) return StellarNetworkStatus.UNHEALTHY;

    if (
      fraction < HEALTHY_THRESHOLD ||
      (averageLatencyMs !== null && averageLatencyMs > DEGRADED_LATENCY_MS)
    ) {
      return StellarNetworkStatus.DEGRADED;
    }

    return StellarNetworkStatus.HEALTHY;
  }

  /**
   * Forward current metrics to the shared {@link MonitoringHooksService} so
   * they appear in the `/metrics` endpoint alongside other service metrics.
   */
  private emitMetricsToHooks(): void {
    const metrics = this.getMetrics();

    this.monitoringHooks.setGauge('stellar_healthy_endpoints', metrics.healthyEndpoints, {
      service: 'stellar',
    });

    this.monitoringHooks.setGauge('stellar_total_endpoints', metrics.totalEndpoints, {
      service: 'stellar',
    });

    this.monitoringHooks.setGauge('stellar_uptime_percentage', metrics.uptimePercentage, {
      service: 'stellar',
    });

    if (metrics.averageLatencyMs !== null) {
      this.monitoringHooks.setGauge('stellar_average_latency_ms', metrics.averageLatencyMs, {
        service: 'stellar',
      });
    }

    this.monitoringHooks.incrementCounter('stellar_total_probes', 1, {
      service: 'stellar',
    });

    // Per-endpoint latency histogram
    for (const endpoint of metrics.endpoints) {
      if (endpoint.latencyMs !== null) {
        this.monitoringHooks.observeHistogram(
          'stellar_endpoint_latency_ms',
          endpoint.latencyMs,
          { service: 'stellar', endpoint: endpoint.url },
        );
      }
    }

    // Network status as a numeric gauge: 2 = healthy, 1 = degraded, 0 = unhealthy
    const statusValue =
      metrics.status === StellarNetworkStatus.HEALTHY
        ? 2
        : metrics.status === StellarNetworkStatus.DEGRADED
        ? 1
        : 0;

    this.monitoringHooks.setGauge('stellar_network_status', statusValue, {
      service: 'stellar',
    });
  }
}
