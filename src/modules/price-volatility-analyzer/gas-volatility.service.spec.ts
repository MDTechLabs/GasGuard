import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { GasVolatilityService } from '../src/gas-volatility/gas-volatility.service';
import { VolatilitySnapshot } from '../src/gas-volatility/entities/volatility-snapshot.entity';
import { GasDataAggregationService } from '../src/gas-volatility/gas-data-aggregation.service';
import { VolatilityEngine } from '../src/gas-volatility/volatility.engine';
import { SUPPORTED_CHAINS } from '../src/gas-volatility/interfaces/gas-volatility.interfaces';

const buildSnapshot = (
  chainId: number,
  index: number,
  level: string,
  ageMs = 0,
): Partial<VolatilitySnapshot> => ({
  id: 'snap-1',
  chainId,
  currentVolatilityIndex: index,
  volatilityLevel: level as any,
  rolling7d: index * 0.9,
  stdDeviation: 5,
  sma24h: 30,
  ema24h: 28,
  shortLongRatio: 1.05,
  sampleSize: 24,
  computedAt: new Date(Date.now() - ageMs),
});

const mockSnapshotRepo = () => ({
  findOne: jest.fn(),
  create: jest.fn((dto) => dto),
  save: jest.fn((e) => Promise.resolve({ ...e, id: 'snap-new' })),
  createQueryBuilder: jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  })),
});

describe('GasVolatilityService', () => {
  let service: GasVolatilityService;
  let snapshotRepo: ReturnType<typeof mockSnapshotRepo>;
  let aggregationService: jest.Mocked<Partial<GasDataAggregationService>>;
  let engine: VolatilityEngine;

  const SUPPORTED = [1, 137];

  beforeEach(async () => {
    aggregationService = {
      getTimeSeries: jest.fn().mockResolvedValue(
        Array.from({ length: 24 }, (_, i) => ({
          timestamp: new Date(Date.now() - (24 - i) * 3_600_000),
          gasPriceGwei: 28 + Math.random() * 4,
        })),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GasVolatilityService,
        { provide: getRepositoryToken(VolatilitySnapshot), useFactory: mockSnapshotRepo },
        { provide: GasDataAggregationService, useValue: aggregationService },
        { provide: VolatilityEngine, useClass: VolatilityEngine },
        { provide: SUPPORTED_CHAINS, useValue: SUPPORTED },
      ],
    }).compile();

    service = module.get(GasVolatilityService);
    snapshotRepo = module.get(getRepositoryToken(VolatilitySnapshot));
    engine = module.get(VolatilityEngine);
  });

  // ─── computeAndSave ───────────────────────────────────────────────────────

  describe('computeAndSave', () => {
    it('should compute metrics and persist snapshot', async () => {
      const snap = await service.computeAndSave(1);

      expect(aggregationService.getTimeSeries).toHaveBeenCalledTimes(2); // 24h + 7d
      expect(snapshotRepo.save).toHaveBeenCalledTimes(1);
      expect(snap.chainId).toBe(1);
      expect(snap.currentVolatilityIndex).toBeGreaterThanOrEqual(0);
    });

    it('should throw NotFoundException for unsupported chain', async () => {
      await expect(service.computeAndSave(999)).rejects.toThrow(NotFoundException);
    });

    it('should classify volatility level correctly', async () => {
      // Force engine to produce low volatility (constant prices)
      (aggregationService.getTimeSeries as jest.Mock).mockResolvedValue(
        Array.from({ length: 24 }, (_, i) => ({
          timestamp: new Date(Date.now() - (24 - i) * 3_600_000),
          gasPriceGwei: 30,
        })),
      );

      const snap = await service.computeAndSave(1);
      expect(snap.volatilityLevel).toBe('Low');
      expect(snap.currentVolatilityIndex).toBe(0);
    });

    it('should call getTimeSeries for both 24h and 7d windows', async () => {
      await service.computeAndSave(1);

      const calls = (aggregationService.getTimeSeries as jest.Mock).mock.calls;
      expect(calls).toHaveLength(2);
      // 24h window is more recent
      const [call24h, call7d] = calls;
      const window24h = call24h[1] as Date;
      const window7d = call7d[1] as Date;
      expect(window7d.getTime()).toBeLessThan(window24h.getTime());
    });
  });

  // ─── getVolatility ────────────────────────────────────────────────────────

  describe('getVolatility', () => {
    it('should return cached snapshot if fresh (< 5 min)', async () => {
      const snap = buildSnapshot(1, 0.42, 'Moderate', 60_000); // 1 min old
      snapshotRepo.findOne.mockResolvedValueOnce(snap);

      const result = await service.getVolatility(1);

      expect(result.chainId).toBe(1);
      expect(result.currentVolatilityIndex).toBe(0.42);
      expect(result.volatilityLevel).toBe('Moderate');
      expect(aggregationService.getTimeSeries).not.toHaveBeenCalled();
    });

    it('should recompute when snapshot is stale (> 5 min)', async () => {
      snapshotRepo.findOne.mockResolvedValueOnce(
        buildSnapshot(1, 0.3, 'Moderate', 6 * 60_000), // 6 min old → stale
      );

      await service.getVolatility(1);

      expect(aggregationService.getTimeSeries).toHaveBeenCalled();
    });

    it('should recompute when no snapshot exists', async () => {
      snapshotRepo.findOne.mockResolvedValueOnce(null);

      await service.getVolatility(1);

      expect(aggregationService.getTimeSeries).toHaveBeenCalled();
    });

    it('should attach a recommendation to the response', async () => {
      const snap = buildSnapshot(1, 0.1, 'Low', 60_000);
      snapshotRepo.findOne.mockResolvedValueOnce(snap);

      const result = await service.getVolatility(1);

      expect(result.recommendation).toBeTruthy();
      expect(result.recommendation).toContain('optimal');
    });

    it('should include computedAt ISO string', async () => {
      const snap = buildSnapshot(1, 0.42, 'Moderate', 60_000);
      snapshotRepo.findOne.mockResolvedValueOnce(snap);

      const result = await service.getVolatility(1);

      expect(result.computedAt).toBeTruthy();
      expect(() => new Date(result.computedAt)).not.toThrow();
    });

    it('should throw NotFoundException for unsupported chain', async () => {
      await expect(service.getVolatility(42)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── getChainComparison ───────────────────────────────────────────────────

  describe('getChainComparison', () => {
    it('should return comparison data for all supported chains', async () => {
      snapshotRepo.findOne
        .mockResolvedValueOnce(buildSnapshot(1, 0.2, 'Low', 60_000))
        .mockResolvedValueOnce(buildSnapshot(137, 0.5, 'Moderate', 60_000));

      const result = await service.getChainComparison();

      expect(result.chains).toHaveLength(2);
      expect(result.chains.map((c) => c.chainId)).toEqual(
        expect.arrayContaining([1, 137]),
      );
    });

    it('should identify lowest-volatility chain', async () => {
      snapshotRepo.findOne
        .mockResolvedValueOnce(buildSnapshot(1, 0.2, 'Low', 60_000))
        .mockResolvedValueOnce(buildSnapshot(137, 0.7, 'High', 60_000));

      const result = await service.getChainComparison();

      expect(result.lowestVolatilityChain).toBe(1);
    });

    it('should include generatedAt timestamp', async () => {
      snapshotRepo.findOne
        .mockResolvedValueOnce(buildSnapshot(1, 0.2, 'Low', 60_000))
        .mockResolvedValueOnce(buildSnapshot(137, 0.3, 'Moderate', 60_000));

      const result = await service.getChainComparison();

      expect(result.generatedAt).toBeTruthy();
    });
  });

  // ─── getHistoricalVolatility ──────────────────────────────────────────────

  describe('getHistoricalVolatility', () => {
    it('should return empty history when no snapshots exist', async () => {
      const result = await service.getHistoricalVolatility(1, 7);
      expect(result.chainId).toBe(1);
      expect(result.history).toEqual([]);
    });

    it('should map snapshot fields correctly', async () => {
      const snap = buildSnapshot(1, 0.42, 'Moderate');
      snapshotRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([snap]),
      });

      const result = await service.getHistoricalVolatility(1, 7);

      expect(result.history).toHaveLength(1);
      expect(result.history[0].volatilityIndex).toBe(0.42);
      expect(result.history[0].volatilityLevel).toBe('Moderate');
    });

    it('should throw NotFoundException for unsupported chain', async () => {
      await expect(service.getHistoricalVolatility(999, 7)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
