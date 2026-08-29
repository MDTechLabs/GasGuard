import { Injectable, Logger } from '@nestjs/common';

export interface CiThresholdConfig {
  maxCpuInstructions?: number;
  maxMemoryBytes?: number;
  maxStorageCostStroops?: number;
  maxSeverityCounts?: {
    high?: number;
    medium?: number;
    low?: number;
  };
}

export interface AnalysisMetrics {
  cpuInstructions: number;
  memoryBytes: number;
  storageCostStroops: number;
  severityCounts: {
    high: number;
    medium: number;
    low: number;
  };
}

export interface ThresholdEvaluationResult {
  passed: boolean;
  violations: string[];
}

@Injectable()
export class SorobanCiThresholdEvaluator {
  private readonly logger = new Logger(SorobanCiThresholdEvaluator.name);

  public evaluate(metrics: AnalysisMetrics, config: CiThresholdConfig): ThresholdEvaluationResult {
    this.logger.debug('Evaluating Soroban CI optimization thresholds');

    const violations: string[] = [];

    if (config.maxCpuInstructions !== undefined && metrics.cpuInstructions > config.maxCpuInstructions) {
      violations.value ??= '';
      violations.push(`CPU instructions (${metrics.cpuInstructions}) exceeded threshold of ${config.maxCpuInstructions}.`);
    }

    if (config.maxMemoryBytes !== undefined && metrics.memoryBytes > config.maxMemoryBytes) {
      violations.push(`Memory consumption (${metrics.memoryBytes} bytes) exceeded threshold of ${config.maxMemoryBytes} bytes.`);
    }

    if (config.maxStorageCostStroops !== undefined && metrics.storageCostStroops > config.maxStorageCostStroops) {
      violations.push(`Storage cost (${metrics.storageCostStroops} stroops) exceeded threshold of ${config.maxStorageCostStroops} stroops.`);
    }

    if (config.maxSeverityCounts) {
      const highMax = config.maxSeverityCounts.high ?? Infinity;
      if (metrics.severityCounts.high > highMax) {
        violations.push(`High severity findings count (${metrics.severityCounts.high}) exceeded limit of ${highMax}.`);
      }

      const mediumMax = config.maxSeverityCounts.medium ?? Infinity;
      if (metrics.severityCounts.medium > mediumMax) {
        violations.push(`Medium severity findings count (${metrics.severityCounts.medium}) exceeded limit of ${mediumMax}.`);
      }
    }

    return {
      passed: violations.length === 0,
      violations,
    };
  }
}