import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GasVolatilityModule } from '../src/gas-volatility/gas-volatility.module';
import { GasPriceRecord } from '../src/gas-volatility/entities/gas-price-record.entity';
import { VolatilitySnapshot } from '../src/gas-volatility/entities/volatility-snapshot.entity';
import { GasDataAggregationService } from '../src/gas-volatility/gas-data-aggregation.service';
import { MockGasDataProvider } from './mock-gas-data.provider';
import {
  GAS_DATA_PROVIDER,
  SUPPORTED_CHAINS,
} from '../src/gas-volatility/interfaces/gas-volatility.interfaces';
import { VolatilityEngine } from '../src/gas-volatility/volatility.engine';
import { GasVolatilityService } from '../src/gas-volatility/gas-volatility.service';
import { GasVolatilityController } from '../src/gas-volatility/gas-volatility.controller';
import { GasVolatilityScheduler } from '../src/gas-volatility/gas-volatility.scheduler';

describe('GasVolatility E2E', () => {
  let app: INestApplication;
  let aggregationService: GasDataAggregationService;
  const SUPPORTED = [1, 137];

  beforeAll(async () => {
    const mockProvider = new MockGasDataProvider(30e9, 0.15);

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [GasPriceRecord, VolatilitySnapshot],
          synchronize: true,
          logging: false,
        }),
        TypeOrmModule.forFeature([GasPriceRecord, VolatilitySnapshot]),
      ],
      controllers: [GasVolatilityController],
      providers: [
        { provide: GAS_DATA_PROVIDER, useValue: mockProvider },
        { provide: SUPPORTED_CHAINS, useValue: SUPPORTED },
        GasDataAggregationService,
        GasVolatilityService,
        GasVolatilityScheduler,
        VolatilityEngine,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    aggregationService = moduleRef.get(GasDataAggregationService);

    // Seed 24 hours of hourly data for chain 1 and chain 137
    await seedData(moduleRef, SUPPORTED);
  });

  afterAll(async () => {
    await app.close();
  });

  // ─── Seeding helper ───────────────────────────────────────────────────────

  async function seedData(moduleRef: TestingModule, chains: number[]) {
    const provider = new MockGasDataProvider(30e9, 0.2);
    const aggSvc = moduleRef.get(GasDataAggregationService);
    const gasPriceRepo = moduleRef.get(
      require('@nestjs/typeorm').getRepositoryToken(GasPriceRecord),
    );

    for (const chainId of chains) {
      const records = provider.generateTimeSeries(chainId, 24, 3_600_000);
      for (const raw of records) {
        const gasPriceGwei =
          (Number(BigInt(raw.baseFee) + BigInt(raw.priorityFee))) / 1e9;
        await gasPriceRepo.save(
          gasPriceRepo.create({
            chainId: raw.chainId,
            baseFee: raw.baseFee,
            priorityFee: raw.priorityFee,
            gasUsed: raw.gasUsed,
            gasLimit: raw.gasLimit,
            blockNumber: raw.blockNumber,
            gasPriceGwei,
            interval: '1h',
            timestamp: raw.timestamp,
          }),
        );
      }
    }
  }

  // ─── GET /gas-volatility ──────────────────────────────────────────────────

  describe('GET /gas-volatility', () => {
    it('should return 200 with valid volatility response for chain 1', async () => {
      const res = await request(app.getHttpServer())
        .get('/gas-volatility')
        .query({ chainId: 1 })
        .expect(200);

      expect(res.body).toMatchObject({
        chainId: 1,
        currentVolatilityIndex: expect.any(Number),
        volatilityLevel: expect.stringMatching(/Low|Moderate|High|Extreme/),
        rolling7d: expect.any(Number),
        recommendation: expect.any(String),
        computedAt: expect.any(String),
      });
    });

    it('should return currentVolatilityIndex between 0 and 1', async () => {
      const res = await request(app.getHttpServer())
        .get('/gas-volatility')
        .query({ chainId: 1 })
        .expect(200);

      expect(res.body.currentVolatilityIndex).toBeGreaterThanOrEqual(0);
      expect(res.body.currentVolatilityIndex).toBeLessThanOrEqual(1);
    });

    it('should return 404 for unsupported chain', async () => {
      await request(app.getHttpServer())
        .get('/gas-volatility')
        .query({ chainId: 999 })
        .expect(404);
    });

    it('should return 400 for missing chainId', async () => {
      await request(app.getHttpServer())
        .get('/gas-volatility')
        .expect(400);
    });

    it('should return 400 for invalid chainId', async () => {
      await request(app.getHttpServer())
        .get('/gas-volatility')
        .query({ chainId: 'abc' })
        .expect(400);
    });
  });

  // ─── GET /gas-volatility/compare ─────────────────────────────────────────

  describe('GET /gas-volatility/compare', () => {
    it('should return comparison for all supported chains', async () => {
      const res = await request(app.getHttpServer())
        .get('/gas-volatility/compare')
        .expect(200);

      expect(res.body.chains).toHaveLength(SUPPORTED.length);
      expect(res.body).toHaveProperty('lowestVolatilityChain');
      expect(res.body).toHaveProperty('generatedAt');
    });

    it('should include all required chain fields', async () => {
      const res = await request(app.getHttpServer())
        .get('/gas-volatility/compare')
        .expect(200);

      for (const chain of res.body.chains) {
        expect(chain).toHaveProperty('chainId');
        expect(chain).toHaveProperty('currentVolatilityIndex');
        expect(chain).toHaveProperty('volatilityLevel');
        expect(chain).toHaveProperty('rolling7d');
      }
    });

    it('lowestVolatilityChain should be in supported chains list', async () => {
      const res = await request(app.getHttpServer())
        .get('/gas-volatility/compare')
        .expect(200);

      expect(SUPPORTED).toContain(res.body.lowestVolatilityChain);
    });
  });

  // ─── GET /gas-volatility/history ─────────────────────────────────────────

  describe('GET /gas-volatility/history', () => {
    it('should return history response structure', async () => {
      const res = await request(app.getHttpServer())
        .get('/gas-volatility/history')
        .query({ chainId: 1 })
        .expect(200);

      expect(res.body).toHaveProperty('chainId', 1);
      expect(res.body).toHaveProperty('history');
      expect(Array.isArray(res.body.history)).toBe(true);
    });

    it('should return 404 for unsupported chain', async () => {
      await request(app.getHttpServer())
        .get('/gas-volatility/history')
        .query({ chainId: 999 })
        .expect(404);
    });
  });

  // ─── POST /gas-volatility/ingest ─────────────────────────────────────────

  describe('POST /gas-volatility/ingest', () => {
    it('should successfully ingest latest gas data', async () => {
      const res = await request(app.getHttpServer())
        .post('/gas-volatility/ingest')
        .query({ chainId: 1 })
        .expect(200);

      expect(res.body.message).toContain('1');
    });
  });

  // ─── Data consistency ─────────────────────────────────────────────────────

  describe('data consistency', () => {
    it('should return same chainId as requested', async () => {
      for (const chainId of SUPPORTED) {
        const res = await request(app.getHttpServer())
          .get('/gas-volatility')
          .query({ chainId })
          .expect(200);

        expect(res.body.chainId).toBe(chainId);
      }
    });

    it('volatilityLevel should match currentVolatilityIndex range', async () => {
      const res = await request(app.getHttpServer())
        .get('/gas-volatility')
        .query({ chainId: 1 })
        .expect(200);

      const { currentVolatilityIndex, volatilityLevel } = res.body;
      if (currentVolatilityIndex <= 0.25) {
        expect(volatilityLevel).toBe('Low');
      } else if (currentVolatilityIndex <= 0.5) {
        expect(volatilityLevel).toBe('Moderate');
      } else if (currentVolatilityIndex <= 0.75) {
        expect(volatilityLevel).toBe('High');
      } else {
        expect(volatilityLevel).toBe('Extreme');
      }
    });
  });
});
