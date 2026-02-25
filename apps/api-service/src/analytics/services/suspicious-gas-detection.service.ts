import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transaction } from '../../database/entities/transaction.entity';
import {
  SuspiciousGasPattern,
  GasPatternDetectionLog,
  SeverityLevel,
  PatternStatus,
  PatternType,
} from '../entities/suspicious-gas-pattern.entity';
import { GasBaseline } from '../entities/gas-baseline.entity';

export interface DetectionResult {
  isSuspicious: boolean;
  severity: SeverityLevel;
  patternType: PatternType;
  deviationScore: number;
  reason: string;
  abnormalGasAmount: number;
}

export interface TransactionData {
  transactionHash: string;
  accountAddress: string;
  chainId: number;
  gasUsed: number;
  gasPrice: number;
  transactionType: string;
  timestamp: Date;
}

@Injectable()
export class SuspiciousGasDetectionService {
  private readonly logger = new Logger(SuspiciousGasDetectionService.name);
  private readonly zScoreThresholdLow: number;
  private readonly zScoreThresholdMedium: number;
  private readonly zScoreThresholdHigh: number;
  private readonly minBaselineSamples: number;
  private readonly frequencyMultiplier: number;
  private readonly gasPriceMultiplier: number;

  constructor(
    @InjectRepository(SuspiciousGasPattern)
    private readonly patternRepository: Repository<SuspiciousGasPattern>,
    @InjectRepository(GasPatternDetectionLog)
    private readonly detectionLogRepository: Repository<GasPatternDetectionLog>,
    @InjectRepository(GasBaseline)
    private readonly baselineRepository: Repository<GasBaseline>,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    private readonly configService: ConfigService,
  ) {
    this.zScoreThresholdLow = this.configService.get('SUSPICIOUS_GAS_ZSCORE_THRESHOLD_LOW', 2.0);
    this.zScoreThresholdMedium = this.configService.get('SUSPICIOUS_GAS_ZSCORE_THRESHOLD_MEDIUM', 3.0);
    this.zScoreThresholdHigh = this.configService.get('SUSPICIOUS_GAS_ZSCORE_THRESHOLD_HIGH', 5.0);
    this.minBaselineSamples = this.configService.get('SUSPICIOUS_GAS_MIN_BASELINE_SAMPLES', 10);
    this.frequencyMultiplier = 10; // 10x normal frequency
    this.gasPriceMultiplier = 5; // 5x average gas price
  }

  /**
   * Process a new transaction for suspicious patterns
   */
  async processTransaction(transaction: TransactionData): Promise<DetectionResult | null> {
    try {
      // Get or compute baseline for the account
      const baseline = await this.getOrComputeBaseline(
        transaction.accountAddress,
        transaction.chainId,
      );

      // Run detection algorithms
      const gasUsageResult = await this.detectAbnormalGasUsage(transaction, baseline);
      if (gasUsageResult.isSuspicious) {
        await this.flagAccount(transaction, gasUsageResult);
        return gasUsageResult;
      }

      const frequencyResult = await this.detectFrequencyAnomaly(transaction);
      if (frequencyResult.isSuspicious) {
        await this.flagAccount(transaction, frequencyResult);
        return frequencyResult;
      }

      const gasPriceResult = await this.detectGasPriceManipulation(transaction, baseline);
      if (gasPriceResult.isSuspicious) {
        await this.flagAccount(transaction, gasPriceResult);
        return gasPriceResult;
      }

      return null;
    } catch (error) {
      this.logger.error('Error processing transaction for suspicious patterns', error);
      return null;
    }
  }

  /**
   * Detect abnormal gas usage using Z-score
   */
  async detectAbnormalGasUsage(
    transaction: TransactionData,
    baseline: GasBaseline | null,
  ): Promise<DetectionResult> {
    if (!baseline || baseline.sampleSize < this.minBaselineSamples) {
      return { isSuspicious: false } as DetectionResult;
    }

    const zScore = this.computeZScore(transaction.gasUsed, baseline.avgGasUsed, baseline.stdDevGasUsed);

    if (zScore > this.zScoreThresholdHigh) {
      return {
        isSuspicious: true,
        severity: SeverityLevel.HIGH,
        patternType: PatternType.ABNORMAL_GAS_USAGE,
        deviationScore: zScore,
        reason: `Gas usage ${zScore.toFixed(2)} standard deviations above baseline`,
        abnormalGasAmount: transaction.gasUsed - baseline.avgGasUsed,
      };
    } else if (zScore > this.zScoreThresholdMedium) {
      return {
        isSuspicious: true,
        severity: SeverityLevel.MEDIUM,
        patternType: PatternType.ABNORMAL_GAS_USAGE,
        deviationScore: zScore,
        reason: `Gas usage ${zScore.toFixed(2)} standard deviations above baseline`,
        abnormalGasAmount: transaction.gasUsed - baseline.avgGasUsed,
      };
    } else if (zScore > this.zScoreThresholdLow) {
      return {
        isSuspicious: true,
        severity: SeverityLevel.LOW,
        patternType: PatternType.ABNORMAL_GAS_USAGE,
        deviationScore: zScore,
        reason: `Gas usage ${zScore.toFixed(2)} standard deviations above baseline`,
        abnormalGasAmount: transaction.gasUsed - baseline.avgGasUsed,
      };
    }

    return { isSuspicious: false } as DetectionResult;
  }

  /**
   * Detect frequency anomalies (potential bot behavior)
   */
  async detectFrequencyAnomaly(transaction: TransactionData): Promise<DetectionResult> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    const recentTxCount = await this.transactionRepository.count({
      where: {
        merchantId: transaction.accountAddress,
        chainId: transaction.chainId.toString(),
      },
    });

    const baseline = await this.getOrComputeBaseline(
      transaction.accountAddress,
      transaction.chainId,
    );

    if (baseline && baseline.avgTransactionFrequency > 0) {
      const currentRate = recentTxCount;
      const baselineRate = baseline.avgTransactionFrequency;

      if (currentRate > baselineRate * this.frequencyMultiplier) {
        const severity = currentRate > baselineRate * 50 ? SeverityLevel.HIGH : 
                        currentRate > baselineRate * 20 ? SeverityLevel.MEDIUM : SeverityLevel.LOW;
        
        return {
          isSuspicious: true,
          severity,
          patternType: PatternType.FREQUENCY_ANOMALY,
          deviationScore: currentRate / baselineRate,
          reason: `Transaction frequency ${(currentRate / baselineRate).toFixed(1)}x above baseline`,
          abnormalGasAmount: 0,
        };
      }
    } else if (recentTxCount > 100) {
      // No baseline but very high frequency
      return {
        isSuspicious: true,
        severity: SeverityLevel.MEDIUM,
        patternType: PatternType.BOT_LIKE_BEHAVIOR,
        deviationScore: recentTxCount,
        reason: `High transaction frequency: ${recentTxCount} transactions in last hour`,
        abnormalGasAmount: 0,
      };
    }

    return { isSuspicious: false } as DetectionResult;
  }

  /**
   * Detect gas price manipulation
   */
  async detectGasPriceManipulation(
    transaction: TransactionData,
    baseline: GasBaseline | null,
  ): Promise<DetectionResult> {
    if (!baseline || baseline.sampleSize < this.minBaselineSamples) {
      return { isSuspicious: false } as DetectionResult;
    }

    const ratio = transaction.gasPrice / baseline.avgGasPrice;

    if (ratio > this.gasPriceMultiplier) {
      return {
        isSuspicious: true,
        severity: ratio > 10 ? SeverityLevel.HIGH : SeverityLevel.MEDIUM,
        patternType: PatternType.GAS_PRICE_MANIPULATION,
        deviationScore: ratio,
        reason: `Gas price ${ratio.toFixed(1)}x above account average`,
        abnormalGasAmount: 0,
      };
    }

    return { isSuspicious: false } as DetectionResult;
  }

  /**
   * Flag an account for suspicious activity
   */
  async flagAccount(
    transaction: TransactionData,
    detectionResult: DetectionResult,
  ): Promise<SuspiciousGasPattern> {
    // Check if there's an existing active flag for this account
    let pattern = await this.patternRepository.findOne({
      where: {
        accountAddress: transaction.accountAddress,
        chainId: transaction.chainId,
        status: PatternStatus.ACTIVE,
        patternType: detectionResult.patternType,
      },
    });

    if (pattern) {
      // Update existing pattern
      pattern.flaggedTransactions += 1;
      pattern.abnormalGasTotal = Number(pattern.abnormalGasTotal) + detectionResult.abnormalGasAmount;
      pattern.lastDetectedAt = new Date();
      pattern.deviationScore = Math.max(pattern.deviationScore || 0, detectionResult.deviationScore);
      
      // Upgrade severity if needed
      if (detectionResult.severity === SeverityLevel.HIGH) {
        pattern.severity = SeverityLevel.HIGH;
      } else if (detectionResult.severity === SeverityLevel.MEDIUM && pattern.severity === SeverityLevel.LOW) {
        pattern.severity = SeverityLevel.MEDIUM;
      }

      await this.patternRepository.save(pattern);
    } else {
      // Create new pattern
      pattern = this.patternRepository.create({
        accountAddress: transaction.accountAddress,
        chainId: transaction.chainId,
        severity: detectionResult.severity,
        patternType: detectionResult.patternType,
        description: detectionResult.reason,
        flaggedTransactions: 1,
        abnormalGasTotal: detectionResult.abnormalGasAmount,
        deviationScore: detectionResult.deviationScore,
        firstDetectedAt: new Date(),
        lastDetectedAt: new Date(),
        status: PatternStatus.ACTIVE,
        metadata: {
          initialTransaction: transaction.transactionHash,
        },
      });

      await this.patternRepository.save(pattern);
    }

    // Log the detection
    const detectionLog = this.detectionLogRepository.create({
      patternId: pattern.id,
      transactionHash: transaction.transactionHash,
      accountAddress: transaction.accountAddress,
      chainId: transaction.chainId,
      gasUsed: transaction.gasUsed,
      gasPrice: transaction.gasPrice,
      deviationScore: detectionResult.deviationScore,
      detectionReason: detectionResult.reason,
    });

    await this.detectionLogRepository.save(detectionLog);

    this.logger.warn(
      `Flagged account ${transaction.accountAddress} on chain ${transaction.chainId}: ${detectionResult.reason}`,
    );

    return pattern;
  }

  /**
   * Get or compute baseline for an account
   */
  async getOrComputeBaseline(
    accountAddress: string,
    chainId: number,
  ): Promise<GasBaseline | null> {
    let baseline = await this.baselineRepository.findOne({
      where: { accountAddress, chainId },
    });

    if (!baseline) {
      baseline = await this.computeBaseline(accountAddress, chainId);
    }

    return baseline;
  }

  /**
   * Compute behavioral baseline for an account
   */
  async computeBaseline(accountAddress: string, chainId: number): Promise<GasBaseline | null> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const transactions = await this.transactionRepository
      .createQueryBuilder('tx')
      .where('tx.merchantId = :account', { account: accountAddress })
      .andWhere('tx.chainId = :chainId', { chainId: chainId.toString() })
      .andWhere('tx.createdAt > :thirtyDaysAgo', { thirtyDaysAgo })
      .andWhere('tx.status = :status', { status: 'success' })
      .orderBy('tx.createdAt', 'ASC')
      .getMany();

    if (transactions.length < this.minBaselineSamples) {
      return null;
    }

    // Calculate statistics
    const gasUsedValues = transactions.map((tx) => Number(tx.gasUsed));
    const gasPriceValues = transactions.map((tx) => Number(tx.gasPrice || 0));

    const avgGasUsed = this.calculateMean(gasUsedValues);
    const stdDevGasUsed = this.calculateStdDev(gasUsedValues, avgGasUsed);
    const avgGasPrice = this.calculateMean(gasPriceValues);

    // Calculate transaction frequency (per hour)
    const firstTx = transactions[0].createdAt;
    const lastTx = transactions[transactions.length - 1].createdAt;
    const hoursSpan = Math.max(1, (lastTx.getTime() - firstTx.getTime()) / (1000 * 60 * 60));
    const avgFrequency = transactions.length / hoursSpan;

    // Get common transaction types
    const txTypeCounts: Record<string, number> = {};
    transactions.forEach((tx) => {
      txTypeCounts[tx.transactionType] = (txTypeCounts[tx.transactionType] || 0) + 1;
    });
    const commonTxTypes = Object.entries(txTypeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([type]) => type);

    const baseline = this.baselineRepository.create({
      accountAddress,
      chainId,
      avgGasUsed,
      stdDevGasUsed,
      avgGasPrice,
      avgTransactionFrequency: avgFrequency,
      commonTxTypes,
      sampleSize: transactions.length,
      lastUpdated: new Date(),
      firstTransactionAt: firstTx,
      lastTransactionAt: lastTx,
    });

    await this.baselineRepository.save(baseline);

    return baseline;
  }

  /**
   * Update baseline for an account
   */
  async updateBaseline(accountAddress: string, chainId: number): Promise<GasBaseline | null> {
    return this.computeBaseline(accountAddress, chainId);
  }

  /**
   * Clear old resolved flags
   */
  async clearOldFlags(olderThanDays: number = 30): Promise<number> {
    const cutoffDate = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

    const result = await this.patternRepository
      .createQueryBuilder()
      .delete()
      .where('status = :status', { status: PatternStatus.CLEARED })
      .andWhere('updatedAt < :cutoff', { cutoff: cutoffDate })
      .execute();

    return result.affected || 0;
  }

  /**
   * Compute Z-score
   */
  private computeZScore(value: number, mean: number, stdDev: number): number {
    if (stdDev === 0) return 0;
    return (value - mean) / stdDev;
  }

  /**
   * Calculate mean
   */
  private calculateMean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  /**
   * Calculate standard deviation
   */
  private calculateStdDev(values: number[], mean: number): number {
    if (values.length === 0) return 0;
    const squaredDiffs = values.map((val) => Math.pow(val - mean, 2));
    const avgSquaredDiff = squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
    return Math.sqrt(avgSquaredDiff);
  }
}
