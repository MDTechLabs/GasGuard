import { Injectable, Logger } from '@nestjs/common';
import { Severity, SpikeType } from './severity.enum';
import { DEFAULT_THRESHOLDS } from './thresholds';
import {
  EnrichedSnapshot,
  ThresholdResult,
} from './gas-spike.interface';
import { SpikeClassifierService } from './spike-classifier.service';

/**
 * ThresholdEngineService
 * ──────────────────────
 * Evaluates enriched snapshots against configured threshold rules and
 * returns a list of ThresholdResult objects—one per rule—indicating
 * which rules fired and at what severity.
 *
 * Rule evaluation is deterministic: given the same input and same
 * thresholds the output is always identical.
 */
@Injectable()
export class ThresholdEngineService {
  private readonly logger = new Logger(ThresholdEngineService.name);

  constructor(private readonly classifier: SpikeClassifierService) {}

  /**
   * Evaluate all threshold rules for a single enriched snapshot.
   * Returns only triggered results (triggered: true).
   */
  evaluate(snapshot: EnrichedSnapshot): ThresholdResult[] {
    const t = this.classifier.getEffectiveThresholds(snapshot.chainId);
    const results: ThresholdResult[] = [];

    // ── Rule 1: Base fee percentage increase ──────────────────────
    const bfPctResult = this.evaluatePercentageRule(
      snapshot.baseFeePercentageChange,
      t.BASE_FEE_PERCENTAGE,
      SpikeType.BASE_FEE_PERCENTAGE,
    );
    if (bfPctResult) results.push(bfPctResult);

    // ── Rule 2: Absolute base fee threshold ───────────────────────
    const absoluteResult = this.evaluateAbsoluteRule(
      snapshot.baseFeeGwei,
      t.ABSOLUTE_GWEI,
      SpikeType.ABSOLUTE_THRESHOLD,
    );
    if (absoluteResult) results.push(absoluteResult);

    // ── Rule 3: Volatility index ──────────────────────────────────
    const volatilityResult = this.evaluateVolatilityRule(
      snapshot.volatilityIndex,
      t.VOLATILITY_INDEX,
    );
    if (volatilityResult) results.push(volatilityResult);

    // ── Rule 4: Priority fee surge ────────────────────────────────
    const pfPctResult = this.evaluatePercentageRule(
      snapshot.priorityFeePercentageChange,
      t.PRIORITY_FEE_PERCENTAGE,
      SpikeType.PRIORITY_FEE_SURGE,
    );
    if (pfPctResult) results.push(pfPctResult);

    if (results.length > 0) {
      this.logger.debug(
        `Chain ${snapshot.chainId}: ${results.length} threshold(s) triggered at ` +
          `${results.map((r) => r.severity).join(', ')}`,
      );
    }

    return results;
  }

  /**
   * Derive the single highest severity from a set of ThresholdResults.
   * Returns null if no results (no spike).
   */
  highestSeverity(results: ThresholdResult[]): Severity | null {
    if (results.length === 0) return null;
    const order = [Severity.INFO, Severity.WARNING, Severity.CRITICAL];
    return results.reduce<Severity>((highest, r) => {
      return order.indexOf(r.severity) > order.indexOf(highest)
        ? r.severity
        : highest;
    }, results[0].severity);
  }

  // ─── Private evaluators ───────────────────────────────────────────

  private evaluatePercentageRule(
    value: number,
    thresholds: { INFO: number; WARNING: number; CRITICAL: number },
    type: SpikeType,
  ): ThresholdResult | null {
    const severity = this.resolveSeverity(value, thresholds);
    if (severity === null) return null;

    return {
      triggered: true,
      spikeType: type,
      severity,
      value,
      threshold: thresholds[this.severityKey(severity)],
      percentageIncrease: value,
    };
  }

  private evaluateAbsoluteRule(
    value: number,
    thresholds: { INFO: number; WARNING: number; CRITICAL: number },
    type: SpikeType,
  ): ThresholdResult | null {
    const severity = this.resolveSeverity(value, thresholds);
    if (severity === null) return null;

    return {
      triggered: true,
      spikeType: type,
      severity,
      value,
      threshold: thresholds[this.severityKey(severity)],
    };
  }

  private evaluateVolatilityRule(
    value: number,
    thresholds: { INFO: number; WARNING: number; CRITICAL: number },
  ): ThresholdResult | null {
    const severity = this.resolveSeverity(value, thresholds);
    if (severity === null) return null;

    return {
      triggered: true,
      spikeType: SpikeType.VOLATILITY_INDEX,
      severity,
      value,
      threshold: thresholds[this.severityKey(severity)],
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  private resolveSeverity(
    value: number,
    t: { INFO: number; WARNING: number; CRITICAL: number },
  ): Severity | null {
    if (value >= t.CRITICAL) return Severity.CRITICAL;
    if (value >= t.WARNING) return Severity.WARNING;
    if (value >= t.INFO) return Severity.INFO;
    return null;
  }

  private severityKey(severity: Severity): 'INFO' | 'WARNING' | 'CRITICAL' {
    return severity === Severity.INFO
      ? 'INFO'
      : severity === Severity.WARNING
      ? 'WARNING'
      : 'CRITICAL';
  }
}
