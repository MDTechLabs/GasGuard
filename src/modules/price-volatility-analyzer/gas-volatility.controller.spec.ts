import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { GasVolatilityController } from '../src/gas-volatility/gas-volatility.controller';
import { GasVolatilityService } from '../src/gas-volatility/gas-volatility.service';
import { GasDataAggregationService } from '../src/gas-volatility/gas-data-aggregation.service';
import {
  VolatilityResponseDto,
  ChainComparisonResponseDto,
  HistoricalVolatilityResponseDto,
} from '../src/gas-volatility/dto/gas-volatility.dto';

const mockVolatilityService = () => ({
  getVolatility: jest.fn(),
  getChainComparison: jest.fn(),
  getHistoricalVolatility: jest.fn(),
});

const mockAggregationService = () => ({
  ingestLatest: jest.fn(),
});

describe('GasVolatilityController', () => {
  let controller: GasVolatilityController;
  let volatilityService: ReturnType<typeof mockVolatilityService>;
  let aggregationService: ReturnType<typeof mockAggregationService>;

  const mockVolatilityResponse: VolatilityResponseDto = {
    chainId: 1,
    currentVolatilityIndex: 0.42,
    volatilityLevel: 'Moderate',
    rolling7d: 0.38,
    recommendation: 'Consider executing transactions during low-volatility windows.',
    computedAt: new Date().toISOString(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GasVolatilityController],
      providers: [
        { provide: GasVolatilityService, useFactory: mockVolatilityService },
        { provide: GasDataAggregationService, useFactory: mockAggregationService },
      ],
    }).compile();

    controller = module.get(GasVolatilityController);
    volatilityService = module.get(GasVolatilityService);
    aggregationService = module.get(GasDataAggregationService);
  });

  // ─── GET /gas-volatility ──────────────────────────────────────────────────

  describe('getVolatility', () => {
    it('should return volatility response for valid chainId', async () => {
      volatilityService.getVolatility.mockResolvedValueOnce(mockVolatilityResponse);

      const result = await controller.getVolatility({ chainId: 1 });

      expect(result).toEqual(mockVolatilityResponse);
      expect(volatilityService.getVolatility).toHaveBeenCalledWith(1);
    });

    it('should propagate NotFoundException for unsupported chain', async () => {
      volatilityService.getVolatility.mockRejectedValueOnce(
        new NotFoundException('Chain 999 is not supported'),
      );

      await expect(controller.getVolatility({ chainId: 999 })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return all required fields in response', async () => {
      volatilityService.getVolatility.mockResolvedValueOnce(mockVolatilityResponse);

      const result = await controller.getVolatility({ chainId: 1 });

      expect(result).toHaveProperty('chainId');
      expect(result).toHaveProperty('currentVolatilityIndex');
      expect(result).toHaveProperty('volatilityLevel');
      expect(result).toHaveProperty('rolling7d');
      expect(result).toHaveProperty('recommendation');
      expect(result).toHaveProperty('computedAt');
    });
  });

  // ─── GET /gas-volatility/compare ─────────────────────────────────────────

  describe('compareChains', () => {
    it('should return chain comparison', async () => {
      const mockComparison: ChainComparisonResponseDto = {
        chains: [
          { chainId: 1, currentVolatilityIndex: 0.2, volatilityLevel: 'Low', rolling7d: 0.18 },
          { chainId: 137, currentVolatilityIndex: 0.5, volatilityLevel: 'Moderate', rolling7d: 0.45 },
        ],
        lowestVolatilityChain: 1,
        generatedAt: new Date().toISOString(),
      };

      volatilityService.getChainComparison.mockResolvedValueOnce(mockComparison);

      const result = await controller.compareChains();

      expect(result.chains).toHaveLength(2);
      expect(result.lowestVolatilityChain).toBe(1);
    });

    it('should call getChainComparison with no arguments', async () => {
      volatilityService.getChainComparison.mockResolvedValueOnce({
        chains: [],
        lowestVolatilityChain: 0,
        generatedAt: new Date().toISOString(),
      });

      await controller.compareChains();

      expect(volatilityService.getChainComparison).toHaveBeenCalledWith();
    });
  });

  // ─── GET /gas-volatility/history ─────────────────────────────────────────

  describe('getHistory', () => {
    it('should return historical data for a chain', async () => {
      const mockHistory: HistoricalVolatilityResponseDto = {
        chainId: 1,
        history: [
          { timestamp: new Date().toISOString(), volatilityIndex: 0.3, volatilityLevel: 'Moderate' },
        ],
      };

      volatilityService.getHistoricalVolatility.mockResolvedValueOnce(mockHistory);

      const result = await controller.getHistory({ chainId: 1 }, 7);

      expect(result.chainId).toBe(1);
      expect(result.history).toHaveLength(1);
      expect(volatilityService.getHistoricalVolatility).toHaveBeenCalledWith(1, 7);
    });

    it('should default to 7 days when not provided', async () => {
      volatilityService.getHistoricalVolatility.mockResolvedValueOnce({
        chainId: 1,
        history: [],
      });

      await controller.getHistory({ chainId: 1 }, undefined as any);

      expect(volatilityService.getHistoricalVolatility).toHaveBeenCalledWith(1, 7);
    });
  });

  // ─── POST /gas-volatility/ingest ─────────────────────────────────────────

  describe('ingestLatest', () => {
    it('should trigger ingestion and return success message', async () => {
      aggregationService.ingestLatest.mockResolvedValueOnce(undefined);

      const result = await controller.ingestLatest({ chainId: 1 });

      expect(result.message).toContain('1');
      expect(aggregationService.ingestLatest).toHaveBeenCalledWith(1);
    });

    it('should propagate errors from aggregation service', async () => {
      aggregationService.ingestLatest.mockRejectedValueOnce(
        new Error('RPC connection failed'),
      );

      await expect(controller.ingestLatest({ chainId: 1 })).rejects.toThrow(
        'RPC connection failed',
      );
    });
  });
});
