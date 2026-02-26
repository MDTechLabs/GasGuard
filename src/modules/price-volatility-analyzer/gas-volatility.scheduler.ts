import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { GasDataAggregationService } from './gas-data-aggregation.service';
import { GasVolatilityService } from './gas-volatility.service';
import { SUPPORTED_CHAINS } from './interfaces/gas-volatility.interfaces';

@Injectable()
export class GasVolatilityScheduler {
  private readonly logger = new Logger(GasVolatilityScheduler.name);

  constructor(
    private readonly aggregationService: GasDataAggregationService,
    private readonly volatilityService: GasVolatilityService,

    @Inject(SUPPORTED_CHAINS)
    private readonly supportedChains: number[],
  ) {}

  /**
   * Ingest raw gas data every minute for all supported chains.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async ingestRawGasData(): Promise<void> {
    this.logger.debug('Running 1-min gas data ingestion');

    await Promise.allSettled(
      this.supportedChains.map(async (chainId) => {
        try {
          await this.aggregationService.ingestLatest(chainId);
        } catch (err) {
          this.logger.error(
            `Failed to ingest gas data for chain=${chainId}: ${(err as Error).message}`,
          );
        }
      }),
    );
  }

  /**
   * Recompute volatility index every 5 minutes for all supported chains.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async recomputeVolatility(): Promise<void> {
    this.logger.debug('Running 5-min volatility recomputation');

    await Promise.allSettled(
      this.supportedChains.map(async (chainId) => {
        try {
          const snapshot = await this.volatilityService.computeAndSave(chainId);
          this.logger.log(
            `chain=${chainId} VI=${snapshot.currentVolatilityIndex} level=${snapshot.volatilityLevel}`,
          );
        } catch (err) {
          this.logger.error(
            `Failed to compute volatility for chain=${chainId}: ${(err as Error).message}`,
          );
        }
      }),
    );
  }

  /**
   * Hourly backfill job — ensures hourly-aggregated records are always fresh.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async hourlyAggregation(): Promise<void> {
    this.logger.debug('Running hourly aggregation backfill');

    const to = new Date();
    const from = new Date(to.getTime() - 2 * 3_600_000); // last 2 hours buffer

    await Promise.allSettled(
      this.supportedChains.map(async (chainId) => {
        try {
          await this.aggregationService.backfill(chainId, from, to, '1h');
        } catch (err) {
          this.logger.error(
            `Hourly aggregation failed for chain=${chainId}: ${(err as Error).message}`,
          );
        }
      }),
    );
  }
}
