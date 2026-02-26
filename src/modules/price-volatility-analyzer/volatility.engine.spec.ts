import { VolatilityEngine } from '../src/gas-volatility/volatility.engine';
import { TimeSeries } from '../src/gas-volatility/interfaces/gas-volatility.interfaces';

describe('VolatilityEngine', () => {
  let engine: VolatilityEngine;

  beforeEach(() => {
    engine = new VolatilityEngine();
  });

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  const makeTimeSeries = (prices: number[], intervalMs = 3_600_000): TimeSeries[] => {
    const now = Date.now();
    return prices.map((gasPriceGwei, i) => ({
      timestamp: new Date(now - (prices.length - i) * intervalMs),
      gasPriceGwei,
    }));
  };

  // ─── computeMetrics ───────────────────────────────────────────────────────────

  describe('computeMetrics', () => {
    it('should return zero metrics for empty series', () => {
      const metrics = engine.computeMetrics([]);
      expect(metrics.currentVolatilityIndex).toBe(0);
      expect(metrics.rolling7d).toBe(0);
      expect(metrics.sampleSize).toBe(0);
    });

    it('should return zero metrics for single data point', () => {
      const series = makeTimeSeries([30]);
      const metrics = engine.computeMetrics(series);
      expect(metrics.currentVolatilityIndex).toBe(0);
      expect(metrics.sampleSize).toBe(1);
    });

    it('should return low volatility for constant prices', () => {
      const series = makeTimeSeries(Array(24).fill(30));
      const metrics = engine.computeMetrics(series);
      expect(metrics.stdDeviation).toBe(0);
      expect(metrics.currentVolatilityIndex).toBe(0);
      expect(metrics.sma24h).toBeCloseTo(30, 2);
    });

    it('should compute positive stdDeviation for varying prices', () => {
      const series = makeTimeSeries([10, 20, 30, 40, 50, 60, 70, 80]);
      const metrics = engine.computeMetrics(series);
      expect(metrics.stdDeviation).toBeGreaterThan(0);
    });

    it('should clamp volatility index between 0 and 1', () => {
      // Extremely high variance
      const series = makeTimeSeries([1, 1000, 1, 1000, 1, 1000, 1, 1000]);
      const metrics = engine.computeMetrics(series);
      expect(metrics.currentVolatilityIndex).toBeGreaterThanOrEqual(0);
      expect(metrics.currentVolatilityIndex).toBeLessThanOrEqual(1);
    });

    it('should produce higher index when prices fluctuate more', () => {
      const stableS = makeTimeSeries([30, 31, 30, 31, 30]);
      const volatileS = makeTimeSeries([10, 50, 10, 80, 10, 90, 10]);

      const stableM = engine.computeMetrics(stableS);
      const volatileM = engine.computeMetrics(volatileS);

      expect(volatileM.currentVolatilityIndex).toBeGreaterThan(
        stableM.currentVolatilityIndex,
      );
    });

    it('should compute shortLongRatio reflecting recent price trend', () => {
      // Rising prices → shortLongRatio > 1
      const risingPrices = Array.from({ length: 24 }, (_, i) => 20 + i * 2);
      const series = makeTimeSeries(risingPrices);
      const metrics = engine.computeMetrics(series);
      expect(metrics.shortLongRatio).toBeGreaterThan(1);
    });

    it('should compute rolling7d from window7d if provided', () => {
      const series24h = makeTimeSeries([30, 32, 31]);
      const series7d = makeTimeSeries(
        Array.from({ length: 7 * 24 }, (_, i) => 10 + (i % 5) * 20),
      );

      const metrics = engine.computeMetrics(series24h, series7d);
      // 7d series has higher variance so rolling7d should be > 0
      expect(metrics.rolling7d).toBeGreaterThan(0);
    });

    it('should compute sampleSize correctly', () => {
      const series = makeTimeSeries([10, 20, 30, 40, 50]);
      const metrics = engine.computeMetrics(series);
      expect(metrics.sampleSize).toBe(5);
    });

    it('should compute EMA using all data points', () => {
      const prices = [30, 32, 28, 35, 25, 40, 22];
      const series = makeTimeSeries(prices);
      const metrics = engine.computeMetrics(series);
      // EMA should be a positive number different from naive mean for volatile data
      expect(metrics.ema24h).toBeGreaterThan(0);
    });
  });

  // ─── classifyVolatility ──────────────────────────────────────────────────────

  describe('classifyVolatility', () => {
    it.each([
      [0, 'Low'],
      [0.25, 'Low'],
      [0.26, 'Moderate'],
      [0.50, 'Moderate'],
      [0.51, 'High'],
      [0.75, 'High'],
      [0.76, 'Extreme'],
      [1.0, 'Extreme'],
    ])('index %f → %s', (index, expected) => {
      expect(engine.classifyVolatility(index)).toBe(expected);
    });
  });

  // ─── buildRecommendation ─────────────────────────────────────────────────────

  describe('buildRecommendation', () => {
    it('should return optimal recommendation for Low', () => {
      const rec = engine.buildRecommendation('Low', 0.1);
      expect(rec).toContain('optimal');
    });

    it('should return cautious recommendation for Moderate', () => {
      const rec = engine.buildRecommendation('Moderate', 0.35);
      expect(rec).toContain('low-volatility windows');
    });

    it('should warn about delays for High volatility', () => {
      const rec = engine.buildRecommendation('High', 0.65);
      expect(rec).toContain('Delay non-urgent');
    });

    it('should strongly advise deferral for Extreme', () => {
      const rec = engine.buildRecommendation('Extreme', 0.9);
      expect(rec).toContain('deferring');
    });
  });

  // ─── Mathematical correctness ─────────────────────────────────────────────────

  describe('mathematical correctness', () => {
    it('should compute correct stdDeviation for known dataset', () => {
      // Known: prices = [2, 4, 4, 4, 5, 5, 7, 9], σ = 2
      const series = makeTimeSeries([2, 4, 4, 4, 5, 5, 7, 9]);
      const metrics = engine.computeMetrics(series);
      expect(metrics.stdDeviation).toBeCloseTo(2, 1);
    });

    it('should compute correct SMA for uniform prices', () => {
      const series = makeTimeSeries(Array(10).fill(42));
      const metrics = engine.computeMetrics(series);
      expect(metrics.sma24h).toBeCloseTo(42, 4);
    });
  });
});
