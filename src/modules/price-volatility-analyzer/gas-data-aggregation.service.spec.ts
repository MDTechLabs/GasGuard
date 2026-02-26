import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GasDataAggregationService } from '../src/gas-volatility/gas-data-aggregation.service';
import { GasPriceRecord } from '../src/gas-volatility/entities/gas-price-record.entity';
import { GAS_DATA_PROVIDER } from '../src/gas-volatility/interfaces/gas-volatility.interfaces';
import { MockGasDataProvider } from './mock-gas-data.provider';

const mockRepo = () => ({
  create: jest.fn((dto) => dto),
  save: jest.fn((entity) => Promise.resolve({ id: 'uuid-1', ...entity })),
  find: jest.fn(),
});

describe('GasDataAggregationService', () => {
  let service: GasDataAggregationService;
  let repo: jest.Mocked<Partial<Repository<GasPriceRecord>>>;
  let provider: MockGasDataProvider;

  beforeEach(async () => {
    provider = new MockGasDataProvider(30e9, 0.1);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GasDataAggregationService,
        { provide: getRepositoryToken(GasPriceRecord), useFactory: mockRepo },
        { provide: GAS_DATA_PROVIDER, useValue: provider },
      ],
    }).compile();

    service = module.get(GasDataAggregationService);
    repo = module.get(getRepositoryToken(GasPriceRecord));
  });

  // ─── ingestLatest ──────────────────────────────────────────────────────────

  describe('ingestLatest', () => {
    it('should fetch latest gas data and persist it', async () => {
      const record = await service.ingestLatest(1);

      expect(repo.create).toHaveBeenCalledTimes(1);
      expect(repo.save).toHaveBeenCalledTimes(1);
      const createCall = (repo.create as jest.Mock).mock.calls[0][0];
      expect(createCall.chainId).toBe(1);
      expect(createCall.interval).toBe('raw');
      expect(createCall.gasPriceGwei).toBeGreaterThan(0);
    });

    it('should convert wei to Gwei correctly', async () => {
      // 30 Gwei base = 30_000_000_000 wei
      jest.spyOn(provider, 'fetchLatestGasData').mockResolvedValueOnce({
        chainId: 1,
        blockNumber: '100',
        baseFee: '24000000000', // 24 Gwei
        priorityFee: '6000000000', // 6 Gwei
        gasUsed: '15000000',
        gasLimit: '30000000',
        timestamp: new Date(),
      });

      await service.ingestLatest(1);

      const createCall = (repo.create as jest.Mock).mock.calls[0][0];
      expect(createCall.gasPriceGwei).toBeCloseTo(30, 4); // 24 + 6
    });
  });

  // ─── backfill ─────────────────────────────────────────────────────────────

  describe('backfill', () => {
    it('should aggregate records into 1h buckets', async () => {
      const from = new Date('2024-01-01T00:00:00Z');
      const to = new Date('2024-01-01T02:00:00Z');

      await service.backfill(1, from, to, '1h');

      // 2-hour range → should produce ≤ 3 hourly buckets
      const saveCount = (repo.save as jest.Mock).mock.calls.length;
      expect(saveCount).toBeGreaterThanOrEqual(1);
      expect(saveCount).toBeLessThanOrEqual(3);
    });

    it('should call provider with correct date range', async () => {
      const spy = jest.spyOn(provider, 'fetchHistoricalGasData');
      const from = new Date('2024-01-01T00:00:00Z');
      const to = new Date('2024-01-01T01:00:00Z');

      await service.backfill(1, from, to, '1h');

      expect(spy).toHaveBeenCalledWith(1, from, to);
    });
  });

  // ─── getTimeSeries ────────────────────────────────────────────────────────

  describe('getTimeSeries', () => {
    it('should return sorted time-series from repository', async () => {
      const now = new Date();
      const mockRecords = [
        { timestamp: new Date(now.getTime() - 2 * 3600000), gasPriceGwei: 25 },
        { timestamp: new Date(now.getTime() - 1 * 3600000), gasPriceGwei: 30 },
        { timestamp: now, gasPriceGwei: 28 },
      ];

      (repo.find as jest.Mock).mockResolvedValueOnce(mockRecords);

      const series = await service.getTimeSeries(
        1,
        new Date(now.getTime() - 3 * 3600000),
        now,
        '1h',
      );

      expect(series).toHaveLength(3);
      expect(series[0].gasPriceGwei).toBe(25);
      expect(series[2].gasPriceGwei).toBe(28);
    });

    it('should return empty array when no records found', async () => {
      (repo.find as jest.Mock).mockResolvedValueOnce([]);

      const series = await service.getTimeSeries(1, new Date(), new Date(), '1h');
      expect(series).toEqual([]);
    });

    it('should query with correct filter parameters', async () => {
      (repo.find as jest.Mock).mockResolvedValueOnce([]);
      const from = new Date('2024-01-01T00:00:00Z');
      const to = new Date('2024-01-02T00:00:00Z');

      await service.getTimeSeries(1, from, to, '5m');

      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            chainId: 1,
            interval: '5m',
          }),
          order: { timestamp: 'ASC' },
        }),
      );
    });
  });
});
