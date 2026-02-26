import { Injectable, Logger } from '@nestjs/common';
import { VolatilityLevel } from '../entities/volatility-snapshot.entity';
import { TimeSeries, VolatilityMetrics } from '../interfaces/gas-volatility.interfaces';

/**
 * VolatilityEngine — deterministic volatility computation.
 *
 * Formula Documentation
 * ─────────────────────
 * 1. Standard Deviation (σ):
 *    σ = sqrt( Σ(xᵢ - μ)² / N )
 *    where μ = mean gas price over the window, N = sample count.
 *
 * 2. Simple Moving Average (SMA-24h):
 *    SMA = (1/N) * Σ xᵢ  over last 24 h window.
 *
 * 3. Exponential Moving Average (EMA-24h):
 *    EMAᵢ = α * xᵢ + (1 - α) * EMAᵢ₋₁
 *    α = 2 / (N + 1)  (standard smoothing factor)
 *
 * 4. Short/Long Ratio:
 *    ratio = SMA(1h) / SMA(24h)
 *    Values > 1 indicate rising gas prices; < 1 indicate falling.
 *
 * 5. Raw Volatility Score (RVS):
 *    RVS = σ / μ  (coefficient of variation, normalized by mean)
 *
 * 6. Volatility Index (VI):
 *    VI = clamp( RVS * deviation_weight + short_long_deviation * ratio_weight, 0, 1 )
 *    deviation_weight = 0.70
 *    ratio_weight     = 0.30
 *    short_long_deviation = |ratio - 1|  (absolute deviation from parity)
 *
 * 7. Rolling 7-day VI:
 *    Average of VIs computed across 7-day lookback window (hourly snapshots).
 *
 * Classification:
 *   0.00–0.25 → Low
 *   0.26–0.50 → Moderate
 *   0.51–0.75 → High
 *   0.76–1.00 → Extreme
 */
@Injectable()
export class VolatilityEngine {
  private readonly logger = new Logger(VolatilityEngine.name);

  private readonly DEVIATION_WEIGHT = 0.7;
  private readonly RATIO_WEIGHT = 0.3;
  private readonly EMA_PERIOD = 24; // hours

  /**
   * Compute full volatility metrics from a time-series dataset.
   * @param series Sorted array of {timestamp, gasPriceGwei} (oldest → newest)
   * @param window7d Optional 7-day series for rolling score; defaults to `series` if omitted
   */
  computeMetrics(series: TimeSeries[], window7d?: TimeSeries[]): VolatilityMetrics {
    if (series.length < 2) {
      this.logger.warn('Insufficient data points for volatility computation, returning zeros');
      return this.zeroMetrics(series.length);
    }

    const prices = series.map((s) => s.gasPriceGwei);
    const mean = this.mean(prices);
    const stdDeviation = this.stdDev(prices, mean);

    const sma24h = mean; // SMA over supplied 24-h window
    const ema24h = this.ema(prices, this.EMA_PERIOD);

    // Short window = last 10% of the series (≈ 1 h when series is 24 h)
    const shortWindowSize = Math.max(1, Math.floor(prices.length * 0.1));
    const shortPrices = prices.slice(-shortWindowSize);
    const smaShort = this.mean(shortPrices);
    const shortLongRatio = sma24h > 0 ? smaShort / sma24h : 1;

    const rawVolatility = mean > 0 ? stdDeviation / mean : 0;
    const shortLongDeviation = Math.abs(shortLongRatio - 1);

    const currentVolatilityIndex = this.clamp(
      rawVolatility * this.DEVIATION_WEIGHT + shortLongDeviation * this.RATIO_WEIGHT,
      0,
      1,
    );

    // 7-day rolling
    const longSeries = window7d ?? series;
    const rolling7d = this.computeRolling7d(longSeries);

    return {
      stdDeviation,
      sma24h,
      ema24h,
      shortLongRatio,
      currentVolatilityIndex,
      rolling7d,
      sampleSize: series.length,
    };
  }

  classifyVolatility(index: number): VolatilityLevel {
    if (index <= 0.25) return 'Low';
    if (index <= 0.50) return 'Moderate';
    if (index <= 0.75) return 'High';
    return 'Extreme';
  }

  buildRecommendation(level: VolatilityLevel, index: number): string {
    const recommendations: Record<VolatilityLevel, string> = {
      Low: 'Gas prices are stable. This is an optimal time to execute transactions.',
      Moderate:
        'Consider executing transactions during low-volatility windows.',
      High:
        'Gas prices are highly volatile. Delay non-urgent transactions or use strict gas limits.',
      Extreme:
        'Extreme volatility detected. Strongly recommend deferring transactions until the market stabilizes.',
    };
    return recommendations[level];
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  private stdDev(values: number[], mu?: number): number {
    if (values.length < 2) return 0;
    const m = mu ?? this.mean(values);
    const variance =
      values.reduce((sum, v) => sum + Math.pow(v - m, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  /**
   * Exponential Moving Average using standard α = 2/(period+1).
   * Returns the last EMA value.
   */
  private ema(values: number[], period: number): number {
    if (values.length === 0) return 0;
    const alpha = 2 / (period + 1);
    let emaVal = values[0];
    for (let i = 1; i < values.length; i++) {
      emaVal = alpha * values[i] + (1 - alpha) * emaVal;
    }
    return emaVal;
  }

  /**
   * Compute rolling 7-day volatility by splitting the series into
   * daily chunks and averaging the per-day volatility index.
   */
  private computeRolling7d(series: TimeSeries[]): number {
    if (series.length < 2) return 0;

    // Group by day
    const days = new Map<string, number[]>();
    for (const point of series) {
      const dayKey = point.timestamp.toISOString().slice(0, 10);
      if (!days.has(dayKey)) days.set(dayKey, []);
      days.get(dayKey)!.push(point.gasPriceGwei);
    }

    const dayIndices: number[] = [];
    for (const [, prices] of days) {
      if (prices.length < 2) continue;
      const m = this.mean(prices);
      const sd = this.stdDev(prices, m);
      dayIndices.push(this.clamp(sd / (m || 1), 0, 1));
    }

    if (dayIndices.length === 0) return 0;
    return this.mean(dayIndices);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  private zeroMetrics(sampleSize: number): VolatilityMetrics {
    return {
      stdDeviation: 0,
      sma24h: 0,
      ema24h: 0,
      shortLongRatio: 1,
      currentVolatilityIndex: 0,
      rolling7d: 0,
      sampleSize,
    };
  }
}
