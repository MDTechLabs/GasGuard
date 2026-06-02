/**
 * Cache Metrics Service
 * Tracks cache hit/miss rates and performance metrics
 */
import { Injectable, Logger } from "@nestjs/common";

export interface CacheMetrics {
  hits: number;
  misses: number;
  hitRate: number;
  totalRequests: number;
  avgResponseTime: number;
}

export interface EndpointMetrics {
  [endpoint: string]: {
    hits: number;
    misses: number;
    totalRequests: number;
    avgResponseTime: number;
  };
}

@Injectable()
export class CacheMetricsService {
  private logger = new Logger("CacheMetricsService");
  private globalMetrics = {
    hits: 0,
    misses: 0,
    totalResponseTime: 0,
    totalRequests: 0,
  };
  private endpointMetrics: EndpointMetrics = {};
  private chainMetrics: Map<number, CacheMetrics> = new Map();

  /**
   * Record cache hit
   */
  recordHit(endpoint: string, chainId?: number, responseTime = 0): void {
    this.globalMetrics.hits++;
    this.globalMetrics.totalRequests++;
    this.globalMetrics.totalResponseTime += responseTime;

    this.updateEndpointMetrics(endpoint, true, responseTime);

    if (chainId) {
      const metrics = this.chainMetrics.get(chainId) || {
        hits: 0,
        misses: 0,
        hitRate: 0,
        totalRequests: 0,
        avgResponseTime: 0,
      };
      metrics.hits++;
      metrics.totalRequests++;
      this.chainMetrics.set(chainId, metrics);
    }
  }

  /**
   * Record cache miss
   */
  recordMiss(endpoint: string, chainId?: number, responseTime = 0): void {
    this.globalMetrics.misses++;
    this.globalMetrics.totalRequests++;
    this.globalMetrics.totalResponseTime += responseTime;

    this.updateEndpointMetrics(endpoint, false, responseTime);

    if (chainId) {
      const metrics = this.chainMetrics.get(chainId) || {
        hits: 0,
        misses: 0,
        hitRate: 0,
        totalRequests: 0,
        avgResponseTime: 0,
      };
      metrics.misses++;
      metrics.totalRequests++;
      this.chainMetrics.set(chainId, metrics);
    }
  }

  /**
   * Update endpoint-specific metrics
   */
  private updateEndpointMetrics(
    endpoint: string,
    isHit: boolean,
    responseTime: number,
  ): void {
    if (!this.endpointMetrics[endpoint]) {
      this.endpointMetrics[endpoint] = {
        hits: 0,
        misses: 0,
        totalRequests: 0,
        avgResponseTime: 0,
      };
    }

    const m = this.endpointMetrics[endpoint];
    if (isHit) {
      m.hits++;
    } else {
      m.misses++;
    }
    m.totalRequests++;
    m.avgResponseTime =
      (m.avgResponseTime * (m.totalRequests - 1) + responseTime) /
      m.totalRequests;
  }

  /**
   * Get global cache metrics
   */
  getGlobalMetrics(): CacheMetrics {
    const total = this.globalMetrics.totalRequests || 1;
    return {
      hits: this.globalMetrics.hits,
      misses: this.globalMetrics.misses,
      hitRate: Math.round((this.globalMetrics.hits / total) * 100 * 100) / 100,
      totalRequests: total,
      avgResponseTime:
        Math.round((this.globalMetrics.totalResponseTime / total) * 100) / 100,
    };
  }

  /**
   * Get per-endpoint metrics
   */
  getEndpointMetrics(): EndpointMetrics {
    return this.endpointMetrics;
  }

  /**
   * Get per-chain metrics
   */
  getChainMetrics(chainId?: number): CacheMetrics | Map<number, CacheMetrics> {
    if (!chainId) {
      return this.chainMetrics;
    }
    return (
      this.chainMetrics.get(chainId) || {
        hits: 0,
        misses: 0,
        hitRate: 0,
        totalRequests: 0,
        avgResponseTime: 0,
      }
    );
  }

  /**
   * Reset metrics
   */
  reset(): void {
    this.globalMetrics = {
      hits: 0,
      misses: 0,
      totalResponseTime: 0,
      totalRequests: 0,
    };
    this.endpointMetrics = {};
    this.chainMetrics.clear();
  }

  /**
   * Log metrics summary
   */
  logMetrics(): void {
    const global = this.getGlobalMetrics();
    this.logger.log(
      `Cache Metrics - Hits: ${global.hits}, Misses: ${global.misses}, Hit Rate: ${global.hitRate}%`,
    );
  }
}
