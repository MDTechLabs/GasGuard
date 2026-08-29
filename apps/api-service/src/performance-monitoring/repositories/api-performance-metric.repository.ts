import { EntityRepository, Repository } from "typeorm";
import {
  ApiPerformanceMetric,
  ApiPerformanceAggregate,
  MetricAggregationWindow,
} from "../entities/api-performance-metric.entity";

@EntityRepository(ApiPerformanceMetric)
export class ApiPerformanceMetricRepository extends Repository<ApiPerformanceMetric> {
  async findMetricsInRange(
    startTime: Date,
    endTime: Date,
    endpoint?: string,
  ): Promise<ApiPerformanceMetric[]> {
    const query = this.createQueryBuilder("metric")
      .where("metric.timestamp >= :startTime", { startTime })
      .andWhere("metric.timestamp <= :endTime", { endTime });

    if (endpoint) {
      query.andWhere("metric.endpoint = :endpoint", { endpoint });
    }

    return query.orderBy("metric.timestamp", "ASC").getMany();
  }

  async findRecentMetrics(
    limit: number = 100,
    endpoint?: string,
  ): Promise<ApiPerformanceMetric[]> {
    const query = this.createQueryBuilder("metric")
      .orderBy("metric.timestamp", "DESC")
      .take(limit);

    if (endpoint) {
      query.andWhere("metric.endpoint = :endpoint", { endpoint });
    }

    return query.getMany();
  }

  async getResponseTimesForAggregation(
    startTime: Date,
    endTime: Date,
    endpoint: string,
    method: string,
  ): Promise<number[]> {
    const results = await this.createQueryBuilder("metric")
      .select("metric.responseTime", "responseTime")
      .where("metric.timestamp >= :startTime", { startTime })
      .andWhere("metric.timestamp <= :endTime", { endTime })
      .andWhere("metric.endpoint = :endpoint", { endpoint })
      .andWhere("metric.method = :method", { method })
      .orderBy("metric.responseTime", "ASC")
      .getRawMany();

    return results.map((r: { responseTime: string }) => Number(r.responseTime));
  }

  async getEndpointStats(startTime: Date, endTime: Date): Promise<any[]> {
    return this.createQueryBuilder("metric")
      .select("metric.endpoint", "endpoint")
      .addSelect("metric.method", "method")
      .addSelect("COUNT(*)", "totalRequests")
      .addSelect("AVG(metric.responseTime)", "avgResponseTime")
      .addSelect("MIN(metric.responseTime)", "minResponseTime")
      .addSelect("MAX(metric.responseTime)", "maxResponseTime")
      .where("metric.timestamp >= :startTime", { startTime })
      .andWhere("metric.timestamp <= :endTime", { endTime })
      .groupBy("metric.endpoint")
      .addGroupBy("metric.method")
      .getRawMany();
  }

  async cleanOldMetrics(olderThanDays: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await this.createQueryBuilder()
      .delete()
      .where("timestamp < :cutoffDate", { cutoffDate })
      .execute();

    return result.affected || 0;
  }
}

@EntityRepository(ApiPerformanceAggregate)
export class ApiPerformanceAggregateRepository extends Repository<ApiPerformanceAggregate> {
  async findAggregates(
    endpoint: string,
    window: MetricAggregationWindow,
    startTime: Date,
    endTime: Date,
  ): Promise<ApiPerformanceAggregate[]> {
    return this.createQueryBuilder("aggregate")
      .where("aggregate.endpoint = :endpoint", { endpoint })
      .andWhere("aggregate.aggregationWindow = :window", { window })
      .andWhere("aggregate.timestamp >= :startTime", { startTime })
      .andWhere("aggregate.timestamp <= :endTime", { endTime })
      .orderBy("aggregate.timestamp", "ASC")
      .getMany();
  }

  async findLatestAggregate(
    endpoint: string,
    window: MetricAggregationWindow,
  ): Promise<ApiPerformanceAggregate | null> {
    return this.createQueryBuilder("aggregate")
      .where("aggregate.endpoint = :endpoint", { endpoint })
      .andWhere("aggregate.aggregationWindow = :window", { window })
      .orderBy("aggregate.timestamp", "DESC")
      .take(1)
      .getOne();
  }
}
