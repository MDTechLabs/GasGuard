import { Injectable, Logger } from '@nestjs/common';
import { Transaction, TxStatus } from './transaction.entity';

export enum SuspiciousActivityType {
  HIGH_FAILURE_RATE = 'HIGH_FAILURE_RATE',
  BURST_TRANSACTIONS = 'BURST_TRANSACTIONS',
  GAS_SPIKE = 'GAS_SPIKE',
}

export enum AlertSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

export interface SuspiciousActivityAlert {
  detected: boolean;
  type?: SuspiciousActivityType;
  severity?: AlertSeverity;
  merchantId: string;
  chainId: number;
  message?: string;
  detectedAt?: string;
  metadata?: Record<string, unknown>;
}

interface TxWindow {
  timestamp: number;
  status: TxStatus;
  gasUsed: number;
}

@Injectable()
export class SuspiciousActivityService {
  private readonly logger = new Logger(SuspiciousActivityService.name);

  /** Rolling in-memory window per merchant+chain (last 50 transactions). */
  private readonly windows = new Map<string, TxWindow[]>();

  private windowKey(merchantId: string, chainId: number): string {
    return `${merchantId}:${chainId}`;
  }

  /**
   * Analyze a newly recorded transaction for suspicious patterns.
   * Emits a structured log warning when an alert is raised.
   */
  analyze(tx: Transaction): SuspiciousActivityAlert {
    const key = this.windowKey(tx.merchantId, tx.chainId);
    const window = this.windows.get(key) ?? [];

    // Keep a rolling window of the last 50 transactions
    window.push({ timestamp: tx.timestamp.getTime(), status: tx.status, gasUsed: Number(tx.gasUsed) });
    if (window.length > 50) window.shift();
    this.windows.set(key, window);

    const base: SuspiciousActivityAlert = {
      detected: false,
      merchantId: tx.merchantId,
      chainId: tx.chainId,
    };

    // Need at least 5 transactions to draw conclusions
    if (window.length < 5) return base;

    const burstAlert = this.detectBurst(tx.merchantId, tx.chainId, window);
    if (burstAlert.detected) {
      this.emitAlert(burstAlert);
      return burstAlert;
    }

    const failureAlert = this.detectHighFailureRate(tx.merchantId, tx.chainId, window);
    if (failureAlert.detected) {
      this.emitAlert(failureAlert);
      return failureAlert;
    }

    const gasAlert = this.detectGasSpike(tx.merchantId, tx.chainId, window);
    if (gasAlert.detected) {
      this.emitAlert(gasAlert);
      return gasAlert;
    }

    return base;
  }

  /**
   * Detect a burst: more than 5 transactions within any 10-second window.
   */
  private detectBurst(
    merchantId: string,
    chainId: number,
    window: TxWindow[],
  ): SuspiciousActivityAlert {
    const now = window[window.length - 1].timestamp;
    const tenSecondsAgo = now - 10_000;
    const burst = window.filter((w) => w.timestamp >= tenSecondsAgo);

    if (burst.length >= 5) {
      const severity = burst.length >= 15 ? AlertSeverity.HIGH
        : burst.length >= 8 ? AlertSeverity.MEDIUM
        : AlertSeverity.LOW;

      return {
        detected: true,
        type: SuspiciousActivityType.BURST_TRANSACTIONS,
        severity,
        merchantId,
        chainId,
        message: `Burst detected: ${burst.length} transactions in 10 seconds.`,
        detectedAt: new Date().toISOString(),
        metadata: { burstCount: burst.length, windowSeconds: 10 },
      };
    }

    return { detected: false, merchantId, chainId };
  }

  /**
   * Detect high failure rate: > 70% of the last 10 transactions failed/reverted.
   */
  private detectHighFailureRate(
    merchantId: string,
    chainId: number,
    window: TxWindow[],
  ): SuspiciousActivityAlert {
    const recent = window.slice(-10);
    const failures = recent.filter(
      (w) => w.status === TxStatus.FAILURE || w.status === TxStatus.REVERTED,
    ).length;
    const failureRate = failures / recent.length;

    if (failureRate >= 0.7) {
      const severity = failureRate >= 0.9 ? AlertSeverity.HIGH
        : failureRate >= 0.8 ? AlertSeverity.MEDIUM
        : AlertSeverity.LOW;

      return {
        detected: true,
        type: SuspiciousActivityType.HIGH_FAILURE_RATE,
        severity,
        merchantId,
        chainId,
        message: `High failure rate detected: ${(failureRate * 100).toFixed(0)}% of last ${recent.length} transactions failed or reverted.`,
        detectedAt: new Date().toISOString(),
        metadata: {
          failureRate: parseFloat((failureRate * 100).toFixed(2)),
          failedTransactions: failures,
          windowSize: recent.length,
        },
      };
    }

    return { detected: false, merchantId, chainId };
  }

  /**
   * Detect a gas spike: latest transaction uses > 4x the rolling average gas.
   */
  private detectGasSpike(
    merchantId: string,
    chainId: number,
    window: TxWindow[],
  ): SuspiciousActivityAlert {
    const latest = window[window.length - 1];
    const prior = window.slice(0, -1);
    if (prior.length === 0) return { detected: false, merchantId, chainId };

    const avgGas = prior.reduce((s, w) => s + w.gasUsed, 0) / prior.length;
    if (avgGas === 0) return { detected: false, merchantId, chainId };

    const ratio = latest.gasUsed / avgGas;

    if (ratio >= 4) {
      const severity = ratio >= 10 ? AlertSeverity.HIGH
        : ratio >= 6 ? AlertSeverity.MEDIUM
        : AlertSeverity.LOW;

      return {
        detected: true,
        type: SuspiciousActivityType.GAS_SPIKE,
        severity,
        merchantId,
        chainId,
        message: `Gas spike detected: ${ratio.toFixed(1)}x above rolling average (${Math.round(avgGas)} avg → ${latest.gasUsed} used).`,
        detectedAt: new Date().toISOString(),
        metadata: {
          gasUsed: latest.gasUsed,
          rollingAvgGas: Math.round(avgGas),
          spikeMultiplier: parseFloat(ratio.toFixed(2)),
        },
      };
    }

    return { detected: false, merchantId, chainId };
  }

  private emitAlert(alert: SuspiciousActivityAlert): void {
    this.logger.warn(
      `[SUSPICIOUS_ACTIVITY] merchant=${alert.merchantId} chain=${alert.chainId} ` +
      `type=${alert.type} severity=${alert.severity} — ${alert.message}`,
      alert.metadata,
    );
  }
}
