/**
 * Cache Metrics Service Tests
 */
/// <reference types="jest" />
import { CacheMetricsService } from "../cache-metrics.service";

describe("CacheMetricsService", () => {
  let metricsService: CacheMetricsService;

  beforeEach(() => {
    metricsService = new CacheMetricsService();
  });

  describe("recording hits and misses", () => {
    it("should record cache hits", () => {
      metricsService.recordHit("test:endpoint", 1, 10);
      const metrics = metricsService.getGlobalMetrics();

      expect(metrics.hits).toBe(1);
      expect(metrics.totalRequests).toBe(1);
    });

    it("should record cache misses", () => {
      metricsService.recordMiss("test:endpoint", 1, 50);
      const metrics = metricsService.getGlobalMetrics();

      expect(metrics.misses).toBe(1);
      expect(metrics.totalRequests).toBe(1);
    });

    it("should calculate hit rate", () => {
      metricsService.recordHit("endpoint1", 1, 10);
      metricsService.recordHit("endpoint1", 1, 15);
      metricsService.recordMiss("endpoint1", 1, 100);

      const metrics = metricsService.getGlobalMetrics();
      expect(metrics.hitRate).toBeCloseTo(66.67, 1);
    });

    it("should calculate average response time", () => {
      metricsService.recordHit("endpoint1", 1, 10);
      metricsService.recordHit("endpoint1", 1, 20);
      metricsService.recordMiss("endpoint1", 1, 30);

      const metrics = metricsService.getGlobalMetrics();
      expect(metrics.avgResponseTime).toBeCloseTo(20, 0);
    });
  });

  describe("endpoint-specific metrics", () => {
    it("should track per-endpoint metrics", () => {
      metricsService.recordHit("base_fee", 1, 10);
      metricsService.recordHit("base_fee", 1, 15);
      metricsService.recordMiss("priority_fee", 1, 50);

      const endpointMetrics = metricsService.getEndpointMetrics();

      expect(endpointMetrics["base_fee"].hits).toBe(2);
      expect(endpointMetrics["base_fee"].totalRequests).toBe(2);
      expect(endpointMetrics["priority_fee"].misses).toBe(1);
    });

    it("should calculate per-endpoint hit rate", () => {
      metricsService.recordHit("endpoint1", 1, 10);
      metricsService.recordHit("endpoint1", 1, 10);
      metricsService.recordMiss("endpoint1", 1, 100);

      const endpointMetrics = metricsService.getEndpointMetrics();
      const endpoint1 = endpointMetrics["endpoint1"];

      expect(endpoint1.hits).toBe(2);
      expect(endpoint1.misses).toBe(1);
      expect(endpoint1.totalRequests).toBe(3);
    });
  });

  describe("chain-specific metrics", () => {
    it("should track per-chain metrics", () => {
      metricsService.recordHit("base_fee", 1, 10);
      metricsService.recordHit("base_fee", 1, 15);
      metricsService.recordMiss("priority_fee", 137, 50);

      const chain1Metrics = metricsService.getChainMetrics(1) as any;
      const chain137Metrics = metricsService.getChainMetrics(137) as any;

      expect(chain1Metrics.hits).toBe(2);
      expect(chain137Metrics.misses).toBe(1);
    });

    it("should return all chain metrics", () => {
      metricsService.recordHit("base_fee", 1, 10);
      metricsService.recordMiss("priority_fee", 137, 50);

      const allMetrics = metricsService.getChainMetrics();
      expect(allMetrics).toBeInstanceOf(Map);
      expect((allMetrics as Map<any, any>).size).toBe(2);
    });
  });

  describe("metrics reset", () => {
    it("should reset all metrics", () => {
      metricsService.recordHit("endpoint1", 1, 10);
      metricsService.recordMiss("endpoint1", 1, 50);

      let metrics = metricsService.getGlobalMetrics();
      expect(metrics.totalRequests).toBe(2);

      metricsService.reset();

      metrics = metricsService.getGlobalMetrics();
      expect(metrics.hits).toBe(0);
      expect(metrics.misses).toBe(0);
      expect(metrics.totalRequests).toBe(0);
    });
  });

  describe("edge cases", () => {
    it("should handle divide by zero in hit rate", () => {
      const metrics = metricsService.getGlobalMetrics();
      expect(metrics.hitRate).toBeDefined();
      expect(typeof metrics.hitRate).toBe("number");
    });

    it("should handle multiple endpoint tracking", () => {
      const endpoints = [
        "base_fee",
        "priority_fee",
        "gas_estimate",
        "chain_metrics",
      ];

      for (const endpoint of endpoints) {
        metricsService.recordHit(endpoint, 1, 10);
        metricsService.recordMiss(endpoint, 1, 50);
      }

      const endpointMetrics = metricsService.getEndpointMetrics();
      expect(Object.keys(endpointMetrics).length).toBe(4);
    });

    it("should track metrics for multiple chains", () => {
      const chains = [1, 137, 8453, 42161];

      for (const chainId of chains) {
        metricsService.recordHit("base_fee", chainId, 10);
        metricsService.recordMiss("base_fee", chainId, 50);
      }

      const allMetrics = metricsService.getChainMetrics();
      expect((allMetrics as Map<any, any>).size).toBe(4);
    });
  });
});
