import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  ApiPerformanceMetric,
  ApiPerformanceAggregate,
  MetricAggregationWindow,
} from "../entities/api-performance-metric.entity";

export interface MetricRecord {
  endpoint: string;
  method: string;
  path?: string;
  statusCode: number;
  responseTime: number;
  requestId?: string;
  ip?: string;
  userAgent?: string;
  timestamp: Date;
}

@Injectable()
export class PerformanceMetricService {
  private readonly logger = new Logger(PerformanceMetricService.name);

  constructor(
    @InjectRepository(ApiPerformanceMetric)
    private readonly metricRepository: Repository<ApiPerformanceMetric>,
    @InjectRepository(ApiPerformanceAggregate)
    private readonly aggregateRepository: Repository<ApiPerformanceAggregate>,
  ) {}

  async recordMetric(metric: MetricRecord): Promise<ApiPerformanceMetric> {
    const newMetric = this.metricRepository.create(metric);
    return this.metricRepository.save(newMetric);
  }

  async getRecentMetrics(
    limit: number = 100,
    endpoint?: string,
  ): Promise<ApiPerformanceMetric[]> {
    return this.metricRepository.find({
      order: { timestamp: "DESC" },
      take: limit,
      where: endpoint ? { endpoint } : undefined,
    });
  }

  async getMetricsInRange(
    startTime: Date,
    endTime: Date,
    endpoint?: string,
  ): Promise<ApiPerformanceMetric[]> {
    return this.metricRepository.find({
      where: {
        timestamp: {
          $gte: startTime,
          $lte: endTime,
        } as any,
        ...(endpoint ? { endpoint } : {}),
      },
      order: { timestamp: "ASC" },
    });
  }

  async getAggregates(
    endpoint: string,
    window: MetricAggregationWindow,
    startTime: Date,
    endTime: Date,
  ): Promise<ApiPerformanceAggregate[]> {
    return this.aggregateRepository.find({
      where: {
        endpoint,
        aggregationWindow: window,
        timestamp: {
          $gte: startTime,
          $lte: endTime,
        } as any,
      },
      order: { timestamp: "ASC" },
    });
  }

  async getLatestAggregate(
    endpoint: string,
    window: MetricAggregationWindow,
  ): Promise<ApiPerformanceAggregate | null> {
    return this.aggregateRepository.findOne({
      where: { endpoint, aggregationWindow: window },
      order: { timestamp: "DESC" },
    });
  }

  /**
   * Calculate percentile from sorted array
   */
  calculatePercentile(sortedValues: number[], percentile: number): number {
    if (sortedValues.length === 0) return 0;
    if (sortedValues.length === 1) return sortedValues[0];

    const index = (percentile / 100) * (sortedValues.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;

    if (upper >= sortedValues.length)
      return sortedValues[sortedValues.length - 1];

    return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
  }

  /**
   * Calculate standard deviation
   */
  calculateStdDev(values: number[], mean: number): number {
    if (values.length === 0) return 0;
    const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
    const avgSquaredDiff =
      squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(avgSquaredDiff);
  }

  /**
   * Aggregate metrics for a specific endpoint and time window
   */
  async aggregateMetrics(
    endpoint: string,
    method: string,
    window: MetricAggregationWindow,
    startTime: Date,
    endTime: Date,
  ): Promise<ApiPerformanceAggregate> {
    const metrics = await this.metricRepository.find({
      where: {
        endpoint,
        method,
        timestamp: {
          $gte: startTime,
          $lte: endTime,
        } as any,
      },
    });

    if (metrics.length === 0) {
      throw new Error(
        `No metrics found for endpoint ${endpoint} in the specified time range`,
      );
    }

    const responseTimes = metrics
      .map((m) => Number(m.responseTime))
      .sort((a, b) => a - b);
    const totalRequests = metrics.length;
    const successfulRequests = metrics.filter(
      (m) => m.statusCode >= 200 && m.statusCode < 400,
    ).length;
    const failedRequests = totalRequests - successfulRequests;
    const successRate = (successfulRequests / totalRequests) * 100;

    const minResponseTime = responseTimes[0];
    const maxResponseTime = responseTimes[responseTimes.length - 1];
    const avgResponseTime =
      responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    const p50ResponseTime = this.calculatePercentile(responseTimes, 50);
    const p90ResponseTime = this.calculatePercentile(responseTimes, 90);
    const p95ResponseTime = this.calculatePercentile(responseTimes, 95);
    const p99ResponseTime = this.calculatePercentile(responseTimes, 99);
    const stdDevResponseTime = this.calculateStdDev(
      responseTimes,
      avgResponseTime,
    );

    const aggregate = this.aggregateRepository.create({
      endpoint,
      method,
      aggregationWindow: window,
      timestamp: endTime,
      totalRequests,
      successfulRequests,
      failedRequests,
      successRate,
      minResponseTime,
      maxResponseTime,
      avgResponseTime,
      p50ResponseTime,
      p90ResponseTime,
      p95ResponseTime,
      p99ResponseTime,
      stdDevResponseTime,
    });

    return this.aggregateRepository.save(aggregate);
  }

  /**
   * Get real-time performance summary (last hour)
   */
  async getRealtimeSummary(): Promise<{
    totalRequests: number;
    avgResponseTime: number;
    p95ResponseTime: number;
    errorRate: number;
    endpoints: Array<{
      endpoint: string;
      requests: number;
      avgResponseTime: number;
      p95ResponseTime: number;
    }>;
  }> {
    const oneHourAgo = new Date();
    oneHourAgo.setHours(oneHourAgo.getHours() - 1);

    const metrics = await this.metricRepository.find({
      where: {
        timestamp: {
          $gte: oneHourAgo,
        } as any,
      },
    });

    if (metrics.length === 0) {
      return {
        totalRequests: 0,
        avgResponseTime: 0,
        p95ResponseTime: 0,
        errorRate: 0,
        endpoints: [],
      };
    }

    const responseTimes = metrics
      .map((m) => Number(m.responseTime))
      .sort((a, b) => a - b);
    const errors = metrics.filter((m) => m.statusCode >= 400).length;

    // Group by endpoint
    const endpointMap = new Map<string, ApiPerformanceMetric[]>();
    for (const metric of metrics) {
      const existing = endpointMap.get(metric.endpoint) || [];
      existing.push(metric);
      endpointMap.set(metric.endpoint, existing);
    }

    const endpoints = Array.from(endpointMap.entries()).map(
      ([endpoint, endpointMetrics]) => {
        const times = endpointMetrics
          .map((m) => Number(m.responseTime))
          .sort((a, b) => a - b);
        return {
          endpoint,
          requests: endpointMetrics.length,
          avgResponseTime: times.reduce((a, b) => a + b, 0) / times.length,
          p95ResponseTime: this.calculatePercentile(times, 95),
        };
      },
    );

    return {
      totalRequests: metrics.length,
      avgResponseTime:
        responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length,
      p95ResponseTime: this.calculatePercentile(responseTimes, 95),
      errorRate: (errors / metrics.length) * 100,
      endpoints,
    };
  }

  /**
   * Clean up old metrics
   */
  async cleanupOldMetrics(retentionDays: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    // Note: In a real implementation, this would use a proper delete query
    // For now, we'll return 0 as a placeholder
    this.logger.log(
      `Would delete metrics older than ${cutoffDate.toISOString()}`,
    );
    return 0;
  }
}
