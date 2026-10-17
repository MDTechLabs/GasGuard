/**
 * Parser recovery diagnostics (#1172).
 *
 * A recovering parser keeps going after a syntax error instead of aborting the
 * file, which is what lets one broken file still produce findings. That only
 * helps if the recoveries are visible: this collector keeps a bounded record of
 * every diagnostic, separated into recovered and unrecovered, so callers can
 * report parse quality without logging file content.
 */

export interface ParserDiagnostic {
  /** 1-based line number the diagnostic starts on. */
  line: number;
  /** 1-based column, when the parser can supply one. */
  column?: number;
  /** Stable machine-readable code, e.g. "unexpected_token". */
  code: string;
  /** Short message. Must never contain file content. */
  message: string;
}

export interface ParserDiagnosticsSnapshot {
  recovered: number;
  unrecovered: number;
  total: number;
  /** Recovery rate in [0, 1]; 1 when there were no diagnostics at all. */
  recoveryRate: number;
  byCode: Record<string, number>;
  /** True when at least one unrecovered error means the result is incomplete. */
  incomplete: boolean;
}

export const DEFAULT_MAX_DIAGNOSTICS = 500;

export class ParserRecoveryDiagnostics {
  private readonly maxDiagnostics: number;
  private readonly diagnostics: Array<{ diagnostic: ParserDiagnostic; recovered: boolean }> = [];
  private dropped = 0;

  constructor(maxDiagnostics: number = DEFAULT_MAX_DIAGNOSTICS) {
    if (!Number.isInteger(maxDiagnostics) || maxDiagnostics <= 0) {
      throw new RangeError("maxDiagnostics must be a positive integer");
    }
    this.maxDiagnostics = maxDiagnostics;
  }

  /** Record a diagnostic the parser recovered from and continued past. */
  recordRecovered(diagnostic: ParserDiagnostic): void {
    this.record(diagnostic, true);
  }

  /** Record a diagnostic that stopped parsing for the file. */
  recordUnrecovered(diagnostic: ParserDiagnostic): void {
    this.record(diagnostic, false);
  }

  /** Number of diagnostics dropped after the bound was reached. */
  droppedCount(): number {
    return this.dropped;
  }

  snapshot(): ParserDiagnosticsSnapshot {
    const byCode: Record<string, number> = {};
    let recovered = 0;

    for (const { diagnostic, recovered: wasRecovered } of this.diagnostics) {
      byCode[diagnostic.code] = (byCode[diagnostic.code] ?? 0) + 1;
      if (wasRecovered) {
        recovered += 1;
      }
    }

    const total = this.diagnostics.length;
    const unrecovered = total - recovered;

    return {
      recovered,
      unrecovered,
      total,
      recoveryRate: total === 0 ? 1 : recovered / total,
      byCode,
      incomplete: unrecovered > 0,
    };
  }

  reset(): void {
    this.diagnostics.length = 0;
    this.dropped = 0;
  }

  private record(diagnostic: ParserDiagnostic, recovered: boolean): void {
    if (!diagnostic || typeof diagnostic.code !== "string" || diagnostic.code.trim() === "") {
      throw new TypeError("diagnostic.code must be a non-empty string");
    }
    if (!Number.isInteger(diagnostic.line) || diagnostic.line < 1) {
      throw new RangeError("diagnostic.line must be a positive integer");
    }

    if (this.diagnostics.length >= this.maxDiagnostics) {
      this.dropped += 1;
      return;
    }

    this.diagnostics.push({ diagnostic, recovered });
  }
}
