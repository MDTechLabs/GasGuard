import { EntityRepository, Repository } from "typeorm";
import {
  ChainPerformanceMetric,
  MetricTimeWindow,
} from "../entities/chain-performance-metric.entity";

@EntityRepository(ChainPerformanceMetric)
export class ChainPerformanceMetricRepository extends Repository<ChainPerformanceMetric> {
  async findByChainAndTimeWindow(
    chainId: string,
    timeWindow: MetricTimeWindow,
  ): Promise<ChainPerformanceMetric[]> {
    return this.find({
      where: { chainId, timeWindow },
      order: { recordedAt: "DESC" },
    });
  }

  async findLatestByChain(
    chainId: string,
    timeWindow: MetricTimeWindow,
  ): Promise<ChainPerformanceMetric | null> {
    return this.findOne({
      where: { chainId, timeWindow },
      order: { recordedAt: "DESC" },
    });
  }

  async findAllLatest(
    timeWindow: MetricTimeWindow,
  ): Promise<ChainPerformanceMetric[]> {
    const subQuery = this.createQueryBuilder("metric")
      .select("MAX(metric.recordedAt)", "maxRecordedAt")
      .where("metric.timeWindow = :timeWindow", { timeWindow })
      .groupBy("metric.chainId");

    return this.createQueryBuilder("metric")
      .innerJoin(
        `(${subQuery.getQuery()})`,
        "latest",
        "metric.recordedAt = latest.maxRecordedAt AND metric.timeWindow = :timeWindow",
        { timeWindow },
      )
      .orderBy("metric.overallReliabilityScore", "DESC")
      .getMany();
  }

  async findByDateRange(
    chainId: string,
    timeWindow: MetricTimeWindow,
    startDate: Date,
    endDate: Date,
  ): Promise<ChainPerformanceMetric[]> {
    return this.createQueryBuilder("metric")
      .where("metric.chainId = :chainId", { chainId })
      .andWhere("metric.timeWindow = :timeWindow", { timeWindow })
      .andWhere("metric.recordedAt BETWEEN :startDate AND :endDate", {
        startDate,
        endDate,
      })
      .orderBy("metric.recordedAt", "ASC")
      .getMany();
  }

  async findByChainsAndTimeWindow(
    chainIds: string[],
    timeWindow: MetricTimeWindow,
  ): Promise<ChainPerformanceMetric[]> {
    if (!chainIds || chainIds.length === 0) {
      return this.findAllLatest(timeWindow);
    }

    return this.createQueryBuilder("metric")
      .where("metric.chainId IN (:...chainIds)", { chainIds })
      .andWhere("metric.timeWindow = :timeWindow", { timeWindow })
      .orderBy("metric.recordedAt", "DESC")
      .getMany();
  }

  async getLatestMetricsForLeaderboard(
    timeWindow: MetricTimeWindow,
    limit: number = 10,
  ): Promise<ChainPerformanceMetric[]> {
    const subQuery = this.createQueryBuilder("metric")
      .select("MAX(metric.recordedAt)", "maxRecordedAt")
      .where("metric.timeWindow = :timeWindow", { timeWindow })
      .groupBy("metric.chainId");

    return this.createQueryBuilder("metric")
      .innerJoin(
        `(${subQuery.getQuery()})`,
        "latest",
        "metric.recordedAt = latest.maxRecordedAt AND metric.timeWindow = :timeWindow",
        { timeWindow },
      )
      .orderBy("metric.overallReliabilityScore", "DESC")
      .limit(limit)
      .getMany();
  }
}
