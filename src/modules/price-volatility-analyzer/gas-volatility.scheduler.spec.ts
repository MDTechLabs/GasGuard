import { Test, TestingModule } from '@nestjs/testing';
import { GasVolatilityScheduler } from '../src/gas-volatility/gas-volatility.scheduler';
import { GasDataAggregationService } from '../src/gas-volatility/gas-data-aggregation.service';
import { GasVolatilityService } from '../src/gas-volatility/gas-volatility.service';
import { SUPPORTED_CHAINS } from '../src/gas-volatility/interfaces/gas-volatility.interfaces';

const mockAggService = () => ({
  ingestLatest: jest.fn().mockResolvedValue({}),
  backfill: jest.fn().mockResolvedValue([]),
});

const mockVolatilityService = () => ({
  computeAndSave: jest.fn().mockResolvedValue({
    chainId: 1,
    currentVolatilityIndex: 0.35,
    volatilityLevel: 'Moderate',
  }),
});

describe('GasVolatilityScheduler', () => {
  let scheduler: GasVolatilityScheduler;
  let aggService: ReturnType<typeof mockAggService>;
  let volatilityService: ReturnType<typeof mockVolatilityService>;

  const CHAINS = [1, 137, 42161];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GasVolatilityScheduler,
        { provide: GasDataAggregationService, useFactory: mockAggService },
        { provide: GasVolatilityService, useFactory: mockVolatilityService },
        { provide: SUPPORTED_CHAINS, useValue: CHAINS },
      ],
    }).compile();

    scheduler = module.get(GasVolatilityScheduler);
    aggService = module.get(GasDataAggregationService);
    volatilityService = module.get(GasVolatilityService);
  });

  // ─── ingestRawGasData ─────────────────────────────────────────────────────

  describe('ingestRawGasData', () => {
    it('should call ingestLatest for each supported chain', async () => {
      await scheduler.ingestRawGasData();

      expect(aggService.ingestLatest).toHaveBeenCalledTimes(CHAINS.length);
      CHAINS.forEach((chainId) => {
        expect(aggService.ingestLatest).toHaveBeenCalledWith(chainId);
      });
    });

    it('should not throw when one chain fails', async () => {
      aggService.ingestLatest
        .mockRejectedValueOnce(new Error('RPC down'))
        .mockResolvedValue({});

      await expect(scheduler.ingestRawGasData()).resolves.not.toThrow();
    });

    it('should continue processing remaining chains after a failure', async () => {
      aggService.ingestLatest
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue({});

      await scheduler.ingestRawGasData();

      // Should still have tried all 3 chains
      expect(aggService.ingestLatest).toHaveBeenCalledTimes(CHAINS.length);
    });
  });

  // ─── recomputeVolatility ──────────────────────────────────────────────────

  describe('recomputeVolatility', () => {
    it('should call computeAndSave for each supported chain', async () => {
      await scheduler.recomputeVolatility();

      expect(volatilityService.computeAndSave).toHaveBeenCalledTimes(CHAINS.length);
    });

    it('should not propagate individual chain failures', async () => {
      volatilityService.computeAndSave
        .mockRejectedValueOnce(new Error('db error'))
        .mockResolvedValue({ chainId: 137, currentVolatilityIndex: 0.3 });

      await expect(scheduler.recomputeVolatility()).resolves.not.toThrow();
    });
  });

  // ─── hourlyAggregation ────────────────────────────────────────────────────

  describe('hourlyAggregation', () => {
    it('should call backfill for each chain with 1h interval', async () => {
      await scheduler.hourlyAggregation();

      expect(aggService.backfill).toHaveBeenCalledTimes(CHAINS.length);
      CHAINS.forEach((chainId) => {
        expect(aggService.backfill).toHaveBeenCalledWith(
          chainId,
          expect.any(Date),
          expect.any(Date),
          '1h',
        );
      });
    });

    it('should use a 2-hour lookback window', async () => {
      const before = Date.now();
      await scheduler.hourlyAggregation();
      const after = Date.now();

      const firstCall = aggService.backfill.mock.calls[0];
      const [, from, to] = firstCall;

      const windowMs = to.getTime() - from.getTime();
      // ~2 hours ± small tolerance
      expect(windowMs).toBeGreaterThanOrEqual(2 * 3_600_000 - 1000);
      expect(windowMs).toBeLessThanOrEqual(2 * 3_600_000 + 1000);
    });

    it('should not propagate individual chain failures', async () => {
      aggService.backfill.mockRejectedValueOnce(new Error('timeout'));

      await expect(scheduler.hourlyAggregation()).resolves.not.toThrow();
    });
  });
});
