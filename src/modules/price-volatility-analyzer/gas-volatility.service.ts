import {
  Injectable,
  Logger,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  VolatilitySnapshot,
  VolatilityLevel,
} from '../entities/volatility-snapshot.entity';
import {
  ChainVolatilityResult,
  SUPPORTED_CHAINS,
} from '../interfaces/gas-volatility.interfaces';
import { GasDataAggregationService } from './gas-data-aggregation.service';
import { VolatilityEngine } from './volatility.engine';
import {
  VolatilityResponseDto,
  ChainComparisonResponseDto,
  HistoricalVolatilityResponseDto,
} from './dto/gas-volatility.dto';

@Injectable()
export class GasVolatilityService {
  private readonly logger = new Logger(GasVolatilityService.name);

  /** How many hours of data to use for the 24-hour window */
  private readonly WINDOW_24H = 24;
  /** Days for the rolling window */
  private readonly WINDOW_7D = 7;

  constructor(
    @InjectRepository(VolatilitySnapshot)
    private readonly snapshotRepo: Repository<VolatilitySnapshot>,

    private readonly aggregationService: GasDataAggregationService,
    private readonly engine: VolatilityEngine,

    @Inject(SUPPORTED_CHAINS)
    private readonly supportedChains: number[],
  ) {}

  /**
   * Compute and persist volatility for a single chain.
   */
  async computeAndSave(chainId: number): Promise<VolatilitySnapshot> {
    this.assertChainSupported(chainId);

    const now = new Date();
    const from24h = new Date(now.getTime() - this.WINDOW_24H * 3_600_000);
    const from7d = new Date(now.getTime() - this.WINDOW_7D * 24 * 3_600_000);

    const series24h = await this.aggregationService.getTimeSeries(
      chainId,
      from24h,
      now,
      '1h',
    );

    const series7d = await this.aggregationService.getTimeSeries(
      chainId,
      from7d,
      now,
      '1h',
    );

    const metrics = this.engine.computeMetrics(series24h, series7d);
    const level = this.engine.classifyVolatility(metrics.currentVolatilityIndex);

    const snapshot = this.snapshotRepo.create({
      chainId,
      currentVolatilityIndex: metrics.currentVolatilityIndex,
      volatilityLevel: level,
      rolling7d: metrics.rolling7d,
      stdDeviation: metrics.stdDeviation,
      sma24h: metrics.sma24h,
      ema24h: metrics.ema24h,
      shortLongRatio: metrics.shortLongRatio,
      sampleSize: metrics.sampleSize,
      computedAt: now,
    });

    return this.snapshotRepo.save(snapshot);
  }

  /**
   * Get the latest volatility result for a chain, refreshing if stale (> 5 min).
   */
  async getVolatility(chainId: number): Promise<VolatilityResponseDto> {
    this.assertChainSupported(chainId);

    let snapshot = await this.getLatestSnapshot(chainId);

    const staleThresholdMs = 5 * 60 * 1000; // 5 minutes
    const isStale =
      !snapshot ||
      Date.now() - snapshot.computedAt.getTime() > staleThresholdMs;

    if (isStale) {
      this.logger.log(`Snapshot stale for chain=${chainId}, recomputing…`);
      snapshot = await this.computeAndSave(chainId);
    }

    const recommendation = this.engine.buildRecommendation(
      snapshot.volatilityLevel as VolatilityLevel,
      snapshot.currentVolatilityIndex,
    );

    return {
      chainId: snapshot.chainId,
      currentVolatilityIndex: Number(snapshot.currentVolatilityIndex),
      volatilityLevel: snapshot.volatilityLevel as VolatilityLevel,
      rolling7d: Number(snapshot.rolling7d),
      recommendation,
      computedAt: snapshot.computedAt.toISOString(),
    };
  }

  /**
   * Get chain comparison across all supported chains.
   */
  async getChainComparison(): Promise<ChainComparisonResponseDto> {
    const results = await Promise.allSettled(
      this.supportedChains.map((id) => this.getVolatility(id)),
    );

    const chains = results
      .filter(
        (r): r is PromiseFulfilledResult<VolatilityResponseDto> =>
          r.status === 'fulfilled',
      )
      .map((r) => ({
        chainId: r.value.chainId,
        currentVolatilityIndex: r.value.currentVolatilityIndex,
        volatilityLevel: r.value.volatilityLevel,
        rolling7d: r.value.rolling7d,
      }));

    const lowestVolatilityChain = chains.reduce(
      (best, chain) =>
        chain.currentVolatilityIndex < best.currentVolatilityIndex
          ? chain
          : best,
      chains[0],
    );

    return {
      chains,
      lowestVolatilityChain: lowestVolatilityChain?.chainId ?? 0,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Return historical snapshots for a chain (last N days).
   */
  async getHistoricalVolatility(
    chainId: number,
    days = 7,
  ): Promise<HistoricalVolatilityResponseDto> {
    this.assertChainSupported(chainId);

    const from = new Date(Date.now() - days * 24 * 3_600_000);

    const snapshots = await this.snapshotRepo
      .createQueryBuilder('s')
      .where('s.chain_id = :chainId', { chainId })
      .andWhere('s.computed_at >= :from', { from })
      .orderBy('s.computed_at', 'ASC')
      .getMany();

    return {
      chainId,
      history: snapshots.map((s) => ({
        timestamp: s.computedAt.toISOString(),
        volatilityIndex: Number(s.currentVolatilityIndex),
        volatilityLevel: s.volatilityLevel,
      })),
    };
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  private async getLatestSnapshot(chainId: number): Promise<VolatilitySnapshot | null> {
    return this.snapshotRepo.findOne({
      where: { chainId },
      order: { computedAt: 'DESC' },
    });
  }

  private assertChainSupported(chainId: number): void {
    if (!this.supportedChains.includes(chainId)) {
      throw new NotFoundException(
        `Chain ${chainId} is not supported. Supported chains: ${this.supportedChains.join(', ')}`,
      );
    }
  }
}
