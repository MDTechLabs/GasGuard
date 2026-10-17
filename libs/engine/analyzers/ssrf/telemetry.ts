/**
 * Telemetry hooks for the SSRF analyzer.
 *
 * Events carry only file paths, rule ids, counts, durations and skip reasons.
 * They never carry source text, target URLs, or matched literals.
 */

export type SsrfSkipReason =
  | "unsupported-file-type"
  | "declaration-file"
  | "file-too-large"
  | "binary-content"
  | "invalid-input"
  | "excluded-by-config";

export interface SsrfFileAnalyzedEvent {
  file: string;
  durationMs: number;
  findingsByRule: Record<string, number>;
}

export interface SsrfFileSkippedEvent {
  file: string;
  reason: SsrfSkipReason;
}

export interface SsrfAnalysisObserver {
  onFileAnalyzed?(event: SsrfFileAnalyzedEvent): void;
  onFileSkipped?(event: SsrfFileSkippedEvent): void;
}

export interface SsrfAnalysisMetricsSnapshot {
  filesAnalyzed: number;
  filesSkipped: number;
  skippedByReason: Partial<Record<SsrfSkipReason, number>>;
  findingsByRule: Record<string, number>;
  totalFindings: number;
  totalDurationMs: number;
}

/** In-process counters; export via metrics backend. */
export class SsrfAnalysisMetrics implements SsrfAnalysisObserver {
  private filesAnalyzed = 0;
  private filesSkipped = 0;
  private totalDurationMs = 0;
  private readonly skippedByReason: Partial<Record<SsrfSkipReason, number>> = {};
  private readonly findingsByRule: Record<string, number> = {};

  onFileAnalyzed(event: SsrfFileAnalyzedEvent): void {
    this.filesAnalyzed++;
    this.totalDurationMs += event.durationMs;
    for (const [ruleId, count] of Object.entries(event.findingsByRule)) {
      this.findingsByRule[ruleId] = (this.findingsByRule[ruleId] ?? 0) + count;
    }
  }

  onFileSkipped(event: SsrfFileSkippedEvent): void {
    this.filesSkipped++;
    this.skippedByReason[event.reason] = (this.skippedByReason[event.reason] ?? 0) + 1;
  }

  snapshot(): SsrfAnalysisMetricsSnapshot {
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

/** Invoke an observer hook safely. */
export function notifySafely(invoke: () => void): void {
  try {
    invoke();
  } catch {
    // Telemetry must never affect analysis results.
  }
}
