import { Injectable } from '@nestjs/common';
import { Severity, SpikeType } from './severity.enum';
import {
  DEFAULT_THRESHOLDS,
  MOVING_AVERAGE_WINDOW,
  MAX_HISTORY_POINTS,
} from './thresholds';
import {
  GasSnapshot,
  EnrichedSnapshot,
  CustomThresholdConfig,
} from './gas-spike.interface';

/**
 * SpikeClassifierService
 * ─────────────────────
 * Maintains a rolling history of gas snapshots per chain and exposes
 * methods to enrich a raw snapshot with derived metrics.
 *
 * Volatility Index Methodology
 * ────────────────────────────
 * The volatility index is a normalised standard deviation of the last
 * MOVING_AVERAGE_WINDOW base-fee samples:
 *
 *   σ  = stddev(baseFees[last N])
 *   VI = σ / mean(baseFees[last N])         (coefficient of variation)
 *   VI is clamped to [0, 1].
 *
 * A VI of 0 means perfectly stable fees; 1 means extreme dispersion.
 */
@Injectable()
export class SpikeClassifierService {
  /** Rolling history: chainId → ordered snapshots (oldest first) */
  private readonly history = new Map<number, GasSnapshot[]>();

  /** Per-chain custom threshold overrides */
  private readonly customThresholds = new Map<
    number,
    CustomThresholdConfig
  >();

  // ─── History management ───────────────────────────────────────────

  addSnapshot(snapshot: GasSnapshot): void {
    const buf = this.history.get(snapshot.chainId) ?? [];
    buf.push(snapshot);
    if (buf.length > MAX_HISTORY_POINTS) buf.shift();
    this.history.set(snapshot.chainId, buf);
  }

  getHistory(chainId: number): GasSnapshot[] {
    return this.history.get(chainId) ?? [];
  }

  clearHistory(chainId: number): void {
    this.history.delete(chainId);
  }

  // ─── Custom thresholds ────────────────────────────────────────────

  setCustomThresholds(config: CustomThresholdConfig): void {
    const key = config.chainId ?? 0; // 0 = global override
    this.customThresholds.set(key, config);
  }

  getEffectiveThresholds(chainId: number): typeof DEFAULT_THRESHOLDS {
    const global = this.customThresholds.get(0);
    const chain = this.customThresholds.get(chainId);
    const merged = { ...global, ...chain };

    return {
      BASE_FEE_PERCENTAGE: {
        INFO: merged.baseFeePercentageInfo ?? DEFAULT_THRESHOLDS.BASE_FEE_PERCENTAGE.INFO,
        WARNING: merged.baseFeePercentageWarning ?? DEFAULT_THRESHOLDS.BASE_FEE_PERCENTAGE.WARNING,
        CRITICAL: merged.baseFeePercentageCritical ?? DEFAULT_THRESHOLDS.BASE_FEE_PERCENTAGE.CRITICAL,
      },
      ABSOLUTE_GWEI: {
        INFO: merged.absoluteGweiInfo ?? DEFAULT_THRESHOLDS.ABSOLUTE_GWEI.INFO,
        WARNING: merged.absoluteGweiWarning ?? DEFAULT_THRESHOLDS.ABSOLUTE_GWEI.WARNING,
        CRITICAL: merged.absoluteGweiCritical ?? DEFAULT_THRESHOLDS.ABSOLUTE_GWEI.CRITICAL,
      },
      VOLATILITY_INDEX: {
        INFO: merged.volatilityInfo ?? DEFAULT_THRESHOLDS.VOLATILITY_INDEX.INFO,
        WARNING: merged.volatilityWarning ?? DEFAULT_THRESHOLDS.VOLATILITY_INDEX.WARNING,
        CRITICAL: merged.volatilityCritical ?? DEFAULT_THRESHOLDS.VOLATILITY_INDEX.CRITICAL,
      },
      PRIORITY_FEE_PERCENTAGE: {
        INFO: merged.priorityFeePercentageInfo ?? DEFAULT_THRESHOLDS.PRIORITY_FEE_PERCENTAGE.INFO,
        WARNING: merged.priorityFeePercentageWarning ?? DEFAULT_THRESHOLDS.PRIORITY_FEE_PERCENTAGE.WARNING,
        CRITICAL: merged.priorityFeePercentageCritical ?? DEFAULT_THRESHOLDS.PRIORITY_FEE_PERCENTAGE.CRITICAL,
      },
    } as unknown as typeof DEFAULT_THRESHOLDS;
  }

  // ─── Enrichment ───────────────────────────────────────────────────

  enrich(snapshot: GasSnapshot): EnrichedSnapshot {
    const buf = this.history.get(snapshot.chainId) ?? [];
    const window = buf.slice(-MOVING_AVERAGE_WINDOW);

    const movingAverageBaseFee = this.mean(window.map((s) => s.baseFeeGwei));
    const movingAveragePriorityFee = this.mean(
      window.map((s) => s.priorityFeeGwei),
    );

    const volatilityIndex = this.computeVolatilityIndex(
      window.map((s) => s.baseFeeGwei),
    );

    const previous = buf[buf.length - 1] ?? snapshot;

    const baseFeePercentageChange =
      previous.baseFeeGwei > 0
        ? ((snapshot.baseFeeGwei - previous.baseFeeGwei) /
            previous.baseFeeGwei) *
          100
        : 0;

    const priorityFeePercentageChange =
      previous.priorityFeeGwei > 0
        ? ((snapshot.priorityFeeGwei - previous.priorityFeeGwei) /
            previous.priorityFeeGwei) *
          100
        : 0;

    return {
      ...snapshot,
      movingAverageBaseFee,
      movingAveragePriorityFee,
      volatilityIndex,
      baseFeePercentageChange,
      priorityFeePercentageChange,
    };
  }

  // ─── Severity classification ──────────────────────────────────────

  /**
   * Classify the overall severity for an enriched snapshot.
   * Returns the highest severity found across all spike types.
   */
  classifySeverity(
    enriched: EnrichedSnapshot,
  ): Severity | null {
    const t = this.getEffectiveThresholds(enriched.chainId);
    let highest: Severity | null = null;

    const elevate = (s: Severity) => {
      const order = [Severity.INFO, Severity.WARNING, Severity.CRITICAL];
      if (
        highest === null ||
        order.indexOf(s) > order.indexOf(highest)
      ) {
        highest = s;
      }
    };

    // Base fee % increase
    const bfPct = enriched.baseFeePercentageChange;
    if (bfPct >= t.BASE_FEE_PERCENTAGE.CRITICAL) elevate(Severity.CRITICAL);
    else if (bfPct >= t.BASE_FEE_PERCENTAGE.WARNING) elevate(Severity.WARNING);
    else if (bfPct >= t.BASE_FEE_PERCENTAGE.INFO) elevate(Severity.INFO);

    // Absolute gwei
    const bf = enriched.baseFeeGwei;
    if (bf >= t.ABSOLUTE_GWEI.CRITICAL) elevate(Severity.CRITICAL);
    else if (bf >= t.ABSOLUTE_GWEI.WARNING) elevate(Severity.WARNING);
    else if (bf >= t.ABSOLUTE_GWEI.INFO) elevate(Severity.INFO);

    // Volatility index
    const vi = enriched.volatilityIndex;
    if (vi >= t.VOLATILITY_INDEX.CRITICAL) elevate(Severity.CRITICAL);
    else if (vi >= t.VOLATILITY_INDEX.WARNING) elevate(Severity.WARNING);
    else if (vi >= t.VOLATILITY_INDEX.INFO) elevate(Severity.INFO);

    // Priority fee %
    const pfPct = enriched.priorityFeePercentageChange;
    if (pfPct >= t.PRIORITY_FEE_PERCENTAGE.CRITICAL) elevate(Severity.CRITICAL);
    else if (pfPct >= t.PRIORITY_FEE_PERCENTAGE.WARNING) elevate(Severity.WARNING);
    else if (pfPct >= t.PRIORITY_FEE_PERCENTAGE.INFO) elevate(Severity.INFO);

    return highest;
  }

  /**
   * Return which SpikeTypes were triggered at or above the given severity.
   */
  getTriggeredSpikeTypes(
    enriched: EnrichedSnapshot,
    severity: Severity,
  ): SpikeType[] {
    const t = this.getEffectiveThresholds(enriched.chainId);
    const severityValue = this.severityValue(severity);
    const triggered: SpikeType[] = [];

    const check = (
      value: number,
      thresholds: { INFO: number; WARNING: number; CRITICAL: number },
      type: SpikeType,
    ) => {
      const s = this.valueToSeverity(value, thresholds);
      if (s !== null && this.severityValue(s) >= severityValue) {
        triggered.push(type);
      }
    };

    check(enriched.baseFeePercentageChange, t.BASE_FEE_PERCENTAGE, SpikeType.BASE_FEE_PERCENTAGE);
    check(enriched.baseFeeGwei, t.ABSOLUTE_GWEI, SpikeType.ABSOLUTE_THRESHOLD);
    check(enriched.volatilityIndex, t.VOLATILITY_INDEX, SpikeType.VOLATILITY_INDEX);
    check(enriched.priorityFeePercentageChange, t.PRIORITY_FEE_PERCENTAGE, SpikeType.PRIORITY_FEE_SURGE);

    return triggered;
  }

  // ─── Math helpers ─────────────────────────────────────────────────

  private mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  private stddev(values: number[]): number {
    if (values.length < 2) return 0;
    const m = this.mean(values);
    const variance =
      values.reduce((acc, v) => acc + Math.pow(v - m, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  private computeVolatilityIndex(baseFees: number[]): number {
    if (baseFees.length < 2) return 0;
    const m = this.mean(baseFees);
    if (m === 0) return 0;
    const cv = this.stddev(baseFees) / m;
    return Math.min(cv, 1); // clamp to [0, 1]
  }

  private severityValue(s: Severity): number {
    return { [Severity.INFO]: 1, [Severity.WARNING]: 2, [Severity.CRITICAL]: 3 }[s];
  }

  private valueToSeverity(
    value: number,
    thresholds: { INFO: number; WARNING: number; CRITICAL: number },
  ): Severity | null {
    if (value >= thresholds.CRITICAL) return Severity.CRITICAL;
    if (value >= thresholds.WARNING) return Severity.WARNING;
    if (value >= thresholds.INFO) return Severity.INFO;
    return null;
  }
}
