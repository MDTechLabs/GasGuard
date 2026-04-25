import { Injectable, BadRequestException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Transaction, TxStatus } from "./transaction.entity";
import { RecordTransactionDto } from "./dto/record-transaction.entity";
import { AlertQueryDto, Granularity, MetricsQueryDto, TimeSeriesQueryDto } from "./metrics-query.dto";
import { RateLimitService, RateLimitStatus } from "./rate-limit.service";
import { SuspiciousActivityService, SuspiciousActivityAlert } from "./suspicious-activity.service";
import { AuditLogService } from "../audit";

function parsePeriod(period: string): { start: Date; end: Date } {
  const parts = period.split("-").map(Number);
  if (parts.length === 2) {
    const [y, m] = parts;
    return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) };
  }
  if (parts.length === 3) {
    const [y, m, d] = parts;
    return { start: new Date(y, m - 1, d), end: new Date(y, m - 1, d + 1) };
  }
  throw new BadRequestException(
    `Invalid period "${period}". Use YYYY-MM or YYYY-MM-DD.`,
  );
}

export interface MetricResult {
  merchantId: string;
  chainId: number;
  period?: string;
  transactionType?: string;
  totalTransactions: number;
  successfulTransactions: number;
  failedTransactions: number;
  revertedTransactions: number;
  successRate: number | null;
  averageGasUsed: number | null;
  breakdownByType: {
    type: string;
    total: number;
    successful: number;
    successRate: number;
  }[];
  generatedAt: string;
}

export interface AlertResult {
  alert: boolean;
  merchantId: string;
  chainId: number;
  period?: string;
  successRate: number | null;
  threshold: number;
  severity?: "warning" | "critical";
  message?: string;
}

export interface RecordTransactionResult {
  transaction: Transaction;
  rateLimit: RateLimitStatus;
  suspiciousActivity: SuspiciousActivityAlert;
}

@Injectable()
export class TransactionsService {
  constructor(
    @InjectRepository(Transaction)
    private readonly txRepo: Repository<Transaction>,
    private readonly rateLimitService: RateLimitService,
    private readonly suspiciousActivityService: SuspiciousActivityService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async record(dto: RecordTransactionDto): Promise<RecordTransactionResult> {
    // Enforce per-merchant rate limits — throws 429 if exceeded
    const rateLimit = this.rateLimitService.check(dto.merchantId);

    const tx = this.txRepo.create({
      ...dto,
      timestamp: dto.timestamp ? new Date(dto.timestamp) : undefined,
    });
    const saved = await this.txRepo.save(tx);

    // Track the timestamp after a successful save
    this.rateLimitService.record(dto.merchantId);

    // Analyze for suspicious patterns
    const suspiciousActivity = this.suspiciousActivityService.analyze(saved);

    // Emit audit log event
    this.auditLogService.emitGasTransaction(
      dto.merchantId,
      dto.chainId,
      dto.txHash,
      Number(dto.gasUsed),
      dto.gasPrice || "0",
      dto.from || "unknown",
      {
        transactionId: saved.id,
        status: saved.status,
        type: saved.type,
      },
    );

    return { transaction: saved, rateLimit, suspiciousActivity };
  }

  /**
   * Build and run an aggregation query for a given merchant + chain.
   * All heavy lifting stays in the DB; we only transfer aggregate numbers.
   */
  private async aggregate(
    merchantId: string,
    chainId: number,
    query: MetricsQueryDto,
  ): Promise<{
    txs: Transaction[];
    total: number;
    successful: number;
    failed: number;
    reverted: number;
    avgGas: number | null;
  }> {
    const qb = this.txRepo
      .createQueryBuilder("tx")
      .where("tx.merchantId = :merchantId", { merchantId })
      .andWhere("tx.chainId = :chainId", { chainId });

    if (query.period) {
      const { start, end } = parsePeriod(query.period);
      qb.andWhere("tx.timestamp >= :start AND tx.timestamp < :end", {
        start,
        end,
      });
    }

    if (query.type) {
      qb.andWhere("tx.type = :type", { type: query.type });
    }

    // Fetch raw rows — for large tables replace with SELECT aggregates only
    const txs = await qb.orderBy("tx.timestamp", "ASC").getMany();

    const total = txs.length;
    const successful = txs.filter((t: any) => t.status === TxStatus.SUCCESS).length;
    const failed = txs.filter((t: any) => t.status === TxStatus.FAILURE).length;
    const reverted = txs.filter((t: any) => t.status === TxStatus.REVERTED).length;
    const avgGas =
      total === 0
        ? null
        : Math.round(txs.reduce((s: any, t: any) => s + Number(t.gasUsed), 0) / total);

    return { txs, total, successful, failed, reverted, avgGas };
  }

  private buildResult(
    txs: Transaction[],
    counts: {
      total: number;
      successful: number;
      failed: number;
      reverted: number;
      avgGas: number | null;
    },
    meta: {
      merchantId: string;
      chainId: number;
      period?: string;
      type?: string;
    },
  ): MetricResult {
    const { total, successful, failed, reverted, avgGas } = counts;
    const successRate =
      total === 0 ? null : parseFloat(((successful / total) * 100).toFixed(2));

    // breakdownByType
    const byType: Record<string, { total: number; successful: number }> = {};
    for (const tx of txs) {
      byType[tx.type] ??= { total: 0, successful: 0 };
      byType[tx.type].total++;
      if (tx.status === TxStatus.SUCCESS) byType[tx.type].successful++;
    }
    const breakdownByType = Object.entries(byType).map(([type, d]) => ({
      type,
      total: d.total,
      successful: d.successful,
      successRate: parseFloat(((d.successful / d.total) * 100).toFixed(2)),
    }));

    return {
      merchantId: meta.merchantId,
      chainId: meta.chainId,
      ...(meta.period && { period: meta.period }),
      ...(meta.type && { transactionType: meta.type }),
      totalTransactions: total,
      successfulTransactions: successful,
      failedTransactions: failed,
      revertedTransactions: reverted,
      successRate,
      averageGasUsed: avgGas,
      breakdownByType,
      generatedAt: new Date().toISOString(),
    };
  }

  // ── Public methods ─────────────────────────────────────────────────────────

  async getMetrics(
    merchantId: string,
    chainId: number,
    query: MetricsQueryDto,
  ): Promise<MetricResult> {
    const counts = await this.aggregate(merchantId, chainId, query);
    return this.buildResult(counts.txs, counts, {
      merchantId,
      chainId,
      period: query.period,
      type: query.type,
    });
  }

  async getMetricsAllChains(
    merchantId: string,
    query: MetricsQueryDto,
  ): Promise<MetricResult[]> {
    // Find distinct chainIds for this merchant via a lightweight query
    const rows = await this.txRepo
      .createQueryBuilder("tx")
      .select("DISTINCT tx.chainId", "chainId")
      .where("tx.merchantId = :merchantId", { merchantId })
      .getRawMany();

    return Promise.all(
      rows.map(({ chainId }) =>
        this.getMetrics(merchantId, Number(chainId), query),
      ),
    );
  }

  async getTimeSeries(
    merchantId: string,
    chainId: number,
    query: TimeSeriesQueryDto,
  ): Promise<MetricResult[]> {
    const counts = await this.aggregate(merchantId, chainId, query);
    if (counts.txs.length === 0) return [];

    const bucketKey = (date: Date): string => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      return query.granularity === Granularity.MONTHLY
        ? `${y}-${m}`
        : `${y}-${m}-${d}`;
    };

    const buckets = new Map<string, Transaction[]>();
    for (const tx of counts.txs) {
      const key = bucketKey(tx.timestamp);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(tx);
    }

    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, txs]) => {
        const total = txs.length;
        const successful = txs.filter(
          (t) => t.status === TxStatus.SUCCESS,
        ).length;
        const failed = txs.filter((t) => t.status === TxStatus.FAILURE).length;
        const reverted = txs.filter(
          (t) => t.status === TxStatus.REVERTED,
        ).length;
        const avgGas = Math.round(
          txs.reduce((s, t) => s + Number(t.gasUsed), 0) / total,
        );
        return this.buildResult(
          txs,
          { total, successful, failed, reverted, avgGas },
          {
            merchantId,
            chainId,
            period,
            type: query.type,
          },
        );
      });
  }

  async checkAlerts(
    merchantId: string,
    chainId: number,
    query: AlertQueryDto,
  ): Promise<AlertResult> {
    const threshold = query.threshold ?? 95;
    const metrics = await this.getMetrics(merchantId, chainId, query);
    const { successRate, totalTransactions } = metrics;

    if (totalTransactions === 0 || successRate === null) {
      return {
        alert: false,
        merchantId,
        chainId,
        successRate: null,
        threshold,
        message: "No data for period.",
      };
    }

    const alert = successRate < threshold;
    return {
      alert,
      merchantId,
      chainId,
      ...(query.period && { period: query.period }),
      successRate,
      threshold,
      ...(alert && {
        severity: successRate < threshold - 10 ? "critical" : "warning",
        message: `Success rate ${successRate}% is below threshold ${threshold}%.`,
      }),
    };
  }
}
