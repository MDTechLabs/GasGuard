/**
 * Telemetry hooks for the SQL Query analyzer.
 */

export type SqlQuerySkipReason =
  | "unsupported-file-type"
  | "declaration-file"
  | "file-too-large"
  | "binary-content"
  | "invalid-input"
  | "excluded-by-config";

export interface SqlQueryFileAnalyzedEvent {
  file: string;
  durationMs: number;
  findingsByRule: Record<string, number>;
}

export interface SqlQueryFileSkippedEvent {
  file: string;
  reason: SqlQuerySkipReason;
}

export interface SqlQueryAnalysisObserver {
  onFileAnalyzed?(event: SqlQueryFileAnalyzedEvent): void;
  onFileSkipped?(event: SqlQueryFileSkippedEvent): void;
}

export interface SqlQueryAnalysisMetricsSnapshot {
  filesAnalyzed: number;
  filesSkipped: number;
  skippedByReason: Partial<Record<SqlQuerySkipReason, number>>;
  findingsByRule: Record<string, number>;
  totalFindings: number;
  totalDurationMs: number;
}

export class SqlQueryAnalysisMetrics implements SqlQueryAnalysisObserver {
  private filesAnalyzed = 0;
  private filesSkipped = 0;
  private totalDurationMs = 0;
  private readonly skippedByReason: Partial<Record<SqlQuerySkipReason, number>> = {};
  private readonly findingsByRule: Record<string, number> = {};

  onFileAnalyzed(event: SqlQueryFileAnalyzedEvent): void {
    this.filesAnalyzed++;
    this.totalDurationMs += event.durationMs;
    for (const [ruleId, count] of Object.entries(event.findingsByRule)) {
      this.findingsByRule[ruleId] = (this.findingsByRule[ruleId] ?? 0) + count;
    }
  }

  onFileSkipped(event: SqlQueryFileSkippedEvent): void {
    this.filesSkipped++;
    this.skippedByReason[event.reason] = (this.skippedByReason[event.reason] ?? 0) + 1;
  }

  snapshot(): SqlQueryAnalysisMetricsSnapshot {
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
    // Telemetry must never alter analysis results.
  }
}
