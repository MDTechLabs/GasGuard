/**
 * Telemetry hooks for the unsafe deserialization analyzer (CWE-502).
 *
 * Events carry only file paths, rule ids, counts, durations and skip reasons.
 * They never carry source text, deserialization payloads, or secrets.
 */

export type DeserializationSkipReason =
  | "unsupported-file-type"
  | "declaration-file"
  | "file-too-large"
  | "binary-content"
  | "invalid-input"
  | "excluded-by-config";

export interface DeserializationFileAnalyzedEvent {
  file: string;
  durationMs: number;
  findingsByRule: Record<string, number>;
}

export interface DeserializationFileSkippedEvent {
  file: string;
  reason: DeserializationSkipReason;
}

export interface DeserializationAnalysisObserver {
  onFileAnalyzed?(event: DeserializationFileAnalyzedEvent): void;
  onFileSkipped?(event: DeserializationFileSkippedEvent): void;
}

export interface DeserializationAnalysisMetricsSnapshot {
  filesAnalyzed: number;
  filesSkipped: number;
  skippedByReason: Partial<Record<DeserializationSkipReason, number>>;
  findingsByRule: Record<string, number>;
  totalFindings: number;
  totalDurationMs: number;
}

export class DeserializationAnalysisMetrics implements DeserializationAnalysisObserver {
  private filesAnalyzed = 0;
  private filesSkipped = 0;
  private totalDurationMs = 0;
  private readonly skippedByReason: Partial<Record<DeserializationSkipReason, number>> = {};
  private readonly findingsByRule: Record<string, number> = {};

  onFileAnalyzed(event: DeserializationFileAnalyzedEvent): void {
    this.filesAnalyzed++;
    this.totalDurationMs += event.durationMs;
    for (const [ruleId, count] of Object.entries(event.findingsByRule)) {
      this.findingsByRule[ruleId] = (this.findingsByRule[ruleId] ?? 0) + count;
    }
  }

  onFileSkipped(event: DeserializationFileSkippedEvent): void {
    this.filesSkipped++;
    this.skippedByReason[event.reason] = (this.skippedByReason[event.reason] ?? 0) + 1;
  }

  snapshot(): DeserializationAnalysisMetricsSnapshot {
    const findingsByRule = { ...this.findingsByRule };
    return {
      filesAnalyzed: this.filesAnalyzed,
      filesSkipped: this.filesSkipped,
      skippedByReason: { ...this.skippedByReason },
      findingsByRule,
      totalFindings: Object.values(findingsByRule).reduce((a, b) => a + b, 0),
      totalDurationMs: this.totalDurationMs,
    };
  }
}

export function notifySafely(invoke: () => void): void {
  try {
    invoke();
  } catch {
    // Telemetry must never change analysis results.
  }
}
