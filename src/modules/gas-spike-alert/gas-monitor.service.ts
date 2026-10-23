import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  AlertPayload,
  GasSnapshot,
} from './gas-spike.interface';
import { Severity } from './severity.enum';
import { RECOMMENDATIONS, MONITOR_INTERVAL_MS } from './thresholds';
import { SpikeClassifierService } from './spike-classifier.service';
import { ThresholdEngineService } from './threshold-engine.service';
import { WebhookDispatcherService } from './webhook-dispatcher.service';

/**
 * GasMonitorService
 * ─────────────────
 * Orchestrates the monitoring loop:
 *
 *  1. Fetch gas data for each tracked chain
 *  2. Enrich snapshot with derived metrics (via SpikeClassifierService)
 *  3. Evaluate threshold rules (via ThresholdEngineService)
 *  4. Build & dispatch AlertPayload if spike detected (via WebhookDispatcherService)
 *
 * In production the `fetchGasSnapshot` method would call an actual
 * RPC/oracle endpoint.  A `setGasFetcher` hook allows injecting a mock
 * or production fetcher at runtime.
 */
@Injectable()
export class GasMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GasMonitorService.name);

  /** Chains currently being monitored */
  private readonly trackedChains = new Set<number>([1]); // Ethereum mainnet by default

  /** Pluggable gas-fetching strategy */
  private gasFetcher: (chainId: number) => Promise<GasSnapshot>;

  /** Interval handle */
  private monitorInterval: ReturnType<typeof setInterval> | null = null;

  /** Most-recent alert per chain (for deduplication / testing) */
  private readonly lastAlerts = new Map<number, AlertPayload>();

  constructor(
    private readonly classifier: SpikeClassifierService,
    private readonly thresholdEngine: ThresholdEngineService,
    private readonly webhookDispatcher: WebhookDispatcherService,
  ) {
    // Default no-op fetcher; overridden by production code
    this.gasFetcher = this.defaultFetcher;
  }

  onModuleInit(): void {
    this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  // ─── Public API ───────────────────────────────────────────────────

  start(): void {
    if (this.monitorInterval) return;
    this.logger.log(
      `Starting gas monitor (${MONITOR_INTERVAL_MS}ms interval, chains: ${[...this.trackedChains].join(', ')})`,
    );
    this.monitorInterval = setInterval(
      () => void this.tick(),
      MONITOR_INTERVAL_MS,
    );
  }

  stop(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
      this.logger.log('Gas monitor stopped');
    }
  }

  trackChain(chainId: number): void {
    this.trackedChains.add(chainId);
    this.logger.log(`Now tracking chain ${chainId}`);
  }

  untrackChain(chainId: number): void {
    this.trackedChains.delete(chainId);
    this.logger.log(`Stopped tracking chain ${chainId}`);
  }

  getTrackedChains(): number[] {
    return [...this.trackedChains];
  }

  setGasFetcher(
    fetcher: (chainId: number) => Promise<GasSnapshot>,
  ): void {
    this.gasFetcher = fetcher;
  }

  getLastAlert(chainId: number): AlertPayload | undefined {
    return this.lastAlerts.get(chainId);
  }

  /**
   * Manually trigger a single monitoring tick (useful for testing /
   * on-demand checks via REST).
   */
  async tick(): Promise<void> {
    await Promise.allSettled(
      [...this.trackedChains].map((chainId) => this.processChain(chainId)),
    );
  }

  // ─── Core monitoring logic ────────────────────────────────────────

  private async processChain(chainId: number): Promise<void> {
    try {
      const snapshot = await this.gasFetcher(chainId);

      // Enrich BEFORE adding to history (history is used for moving average)
      const enriched = this.classifier.enrich(snapshot);

      // Now persist the new snapshot
      this.classifier.addSnapshot(snapshot);

      const results = this.thresholdEngine.evaluate(enriched);
      const severity = this.thresholdEngine.highestSeverity(results);

      if (!severity) {
        this.logger.debug(`Chain ${chainId}: no spike detected`);
        return;
      }

      const history = this.classifier.getHistory(chainId);
      const previous = history[history.length - 2] ?? snapshot;

      const payload = this.buildAlertPayload(
        enriched,
        previous.baseFeeGwei,
        previous.priorityFeeGwei,
        severity,
        results.map((r) => r.spikeType),
      );

      this.lastAlerts.set(chainId, payload);

      this.logger.warn(
        `🚨 Gas spike detected on chain ${chainId}: ${severity} — ` +
          `base fee ${payload.previousBaseFee} → ${payload.currentBaseFee} ` +
          `(+${payload.percentageIncrease.toFixed(1)}%)`,
      );

      await this.webhookDispatcher.dispatchAll(payload);
    } catch (err) {
      this.logger.error(
        `Error processing chain ${chainId}: ${(err as Error).message}`,
      );
    }
  }

  // ─── Payload builder ─────────────────────────────────────────────

  buildAlertPayload(
    enriched: ReturnType<SpikeClassifierService['enrich']>,
    previousBaseFee: number,
    previousPriorityFee: number,
    severity: Severity,
    spikeTypes: ReturnType<ThresholdEngineService['evaluate']>[number]['spikeType'][],
  ): AlertPayload {
    return {
      chainId: enriched.chainId,
      severity,
      spikeTypes: [...new Set(spikeTypes)],
      previousBaseFee: `${previousBaseFee.toFixed(2)} gwei`,
      currentBaseFee: `${enriched.baseFeeGwei.toFixed(2)} gwei`,
      previousPriorityFee: `${previousPriorityFee.toFixed(2)} gwei`,
      currentPriorityFee: `${enriched.priorityFeeGwei.toFixed(2)} gwei`,
      percentageIncrease: parseFloat(
        enriched.baseFeePercentageChange.toFixed(2),
      ),
      volatilityIndex: parseFloat(enriched.volatilityIndex.toFixed(4)),
      timestamp: enriched.timestamp,
      recommendation: RECOMMENDATIONS[severity],
    };
  }

  // ─── Default fetcher (stub) ───────────────────────────────────────

  private readonly defaultFetcher = async (
    chainId: number,
  ): Promise<GasSnapshot> => {
    this.logger.warn(
      `No gas fetcher configured for chain ${chainId}. Using stub data.`,
    );
    return {
      chainId,
      baseFeeGwei: 20,
      priorityFeeGwei: 1,
      timestamp: Math.floor(Date.now() / 1000),
    };
  };
}
