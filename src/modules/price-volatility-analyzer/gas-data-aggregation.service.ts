import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { GasPriceRecord } from '../entities/gas-price-record.entity';
import {
  GasDataProvider,
  GAS_DATA_PROVIDER,
  RawGasData,
  TimeSeries,
} from '../interfaces/gas-volatility.interfaces';

type Interval = '1m' | '5m' | '1h' | 'raw';

const INTERVAL_MS: Record<Interval, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '1h': 3_600_000,
  raw: 0,
};

@Injectable()
export class GasDataAggregationService {
  private readonly logger = new Logger(GasDataAggregationService.name);

  constructor(
    @InjectRepository(GasPriceRecord)
    private readonly gasPriceRepo: Repository<GasPriceRecord>,

    @Inject(GAS_DATA_PROVIDER)
    private readonly provider: GasDataProvider,
  ) {}

  /**
   * Ingest latest gas data for a chain and store it.
   */
  async ingestLatest(chainId: number): Promise<GasPriceRecord> {
    const raw = await this.provider.fetchLatestGasData(chainId);
    return this.saveRecord(raw, 'raw');
  }

  /**
   * Backfill historical gas data for a chain within a date range.
   */
  async backfill(
    chainId: number,
    from: Date,
    to: Date,
    interval: Interval = '1h',
  ): Promise<GasPriceRecord[]> {
    this.logger.log(
      `Backfilling chain=${chainId} from=${from.toISOString()} to=${to.toISOString()} interval=${interval}`,
    );

    const rawRecords = await this.provider.fetchHistoricalGasData(chainId, from, to);
    const aggregated = this.aggregateByInterval(rawRecords, interval);

    const saved: GasPriceRecord[] = [];
    for (const raw of aggregated) {
      const record = await this.saveRecord(raw, interval);
      saved.push(record);
    }

    this.logger.log(`Saved ${saved.length} records for chain=${chainId}`);
    return saved;
  }

  /**
   * Fetch time-series data for volatility computation.
   * Returns data sorted oldest → newest.
   */
  async getTimeSeries(
    chainId: number,
    from: Date,
    to: Date,
    interval: Interval = '1h',
  ): Promise<TimeSeries[]> {
    const records = await this.gasPriceRepo.find({
      where: {
        chainId,
        interval,
        timestamp: Between(from, to),
      },
      order: { timestamp: 'ASC' },
    });

    return records.map((r) => ({
      timestamp: r.timestamp,
      gasPriceGwei: Number(r.gasPriceGwei),
    }));
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private async saveRecord(raw: RawGasData, interval: Interval): Promise<GasPriceRecord> {
    const gasPriceGwei = this.weiToGwei(
      BigInt(raw.baseFee) + BigInt(raw.priorityFee),
    );

    const record = this.gasPriceRepo.create({
      chainId: raw.chainId,
      baseFee: raw.baseFee,
      priorityFee: raw.priorityFee,
      gasUsed: raw.gasUsed,
      gasLimit: raw.gasLimit,
      blockNumber: raw.blockNumber,
      gasPriceGwei,
      interval,
      timestamp: raw.timestamp,
    });

    return this.gasPriceRepo.save(record);
  }

  /**
   * Bucket raw records into fixed-size time windows and average the gas price.
   */
  private aggregateByInterval(records: RawGasData[], interval: Interval): RawGasData[] {
    if (interval === 'raw') return records;

    const windowMs = INTERVAL_MS[interval];
    const buckets = new Map<number, RawGasData[]>();

    for (const record of records) {
      const bucket = Math.floor(record.timestamp.getTime() / windowMs) * windowMs;
      if (!buckets.has(bucket)) buckets.set(bucket, []);
      buckets.get(bucket)!.push(record);
    }

    const result: RawGasData[] = [];

    for (const [bucketMs, group] of buckets) {
      const avgBaseFee =
        group.reduce((s, r) => s + BigInt(r.baseFee), BigInt(0)) /
        BigInt(group.length);
      const avgPriorityFee =
        group.reduce((s, r) => s + BigInt(r.priorityFee), BigInt(0)) /
        BigInt(group.length);
      const avgGasUsed =
        group.reduce((s, r) => s + BigInt(r.gasUsed), BigInt(0)) /
        BigInt(group.length);
      const avgGasLimit =
        group.reduce((s, r) => s + BigInt(r.gasLimit), BigInt(0)) /
        BigInt(group.length);

      result.push({
        chainId: group[0].chainId,
        blockNumber: group[group.length - 1].blockNumber,
        baseFee: avgBaseFee.toString(),
        priorityFee: avgPriorityFee.toString(),
        gasUsed: avgGasUsed.toString(),
        gasLimit: avgGasLimit.toString(),
        timestamp: new Date(bucketMs),
      });
    }

    return result.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  private weiToGwei(wei: bigint): number {
    return Number(wei) / 1e9;
  }
}
