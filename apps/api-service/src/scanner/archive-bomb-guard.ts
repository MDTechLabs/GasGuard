/**
 * Decompression-bomb guard for archive extraction.
 *
 * Self-contained: call `new ArchiveBombGuard(limits)` and `check()` each entry
 * as it is read (with the size actually inflated so far) or `validate()` an
 * entry list up front. Path-traversal / symlink validation is intentionally
 * NOT handled here.
 */

export interface ArchiveBombLimits {
  maxTotalUncompressedBytes: number;
  maxCompressionRatio: number;
  maxEntryCount: number;
  maxEntryBytes: number;
}

export const DEFAULT_BOMB_LIMITS: Readonly<ArchiveBombLimits> = {
  maxTotalUncompressedBytes: 200 * 1024 * 1024,
  maxCompressionRatio: 100,
  maxEntryCount: 10_000,
  maxEntryBytes: 10 * 1024 * 1024,
};

export type ArchiveBombReason =
  | "TOTAL_SIZE_EXCEEDED"
  | "RATIO_EXCEEDED"
  | "ENTRY_COUNT_EXCEEDED"
  | "ENTRY_SIZE_EXCEEDED";

export class ArchiveBombError extends Error {
  constructor(
    public readonly reason: ArchiveBombReason,
    message: string,
  ) {
    super(message);
    this.name = "ArchiveBombError";
  }
}

export interface BombCheckEntry {
  name: string;
  compressedBytes: number;
  uncompressedBytes: number;
}

export class ArchiveBombGuard {
  private entries = 0;
  private total = 0;
  private totalCompressed = 0;
  private readonly limits: ArchiveBombLimits;

  constructor(limits: Partial<ArchiveBombLimits> = {}) {
    this.limits = { ...DEFAULT_BOMB_LIMITS, ...limits };
  }

  /** Records one entry; throws ArchiveBombError when any limit is exceeded. */
  check(entry: BombCheckEntry): void {
    const l = this.limits;
    this.entries += 1;
    if (this.entries > l.maxEntryCount) {
      throw new ArchiveBombError(
        "ENTRY_COUNT_EXCEEDED",
        `archive has more than ${l.maxEntryCount} entries`,
      );
    }
    if (entry.uncompressedBytes > l.maxEntryBytes) {
      throw new ArchiveBombError(
        "ENTRY_SIZE_EXCEEDED",
        `entry "${entry.name}" exceeds ${l.maxEntryBytes} bytes`,
      );
    }
    this.total += entry.uncompressedBytes;
    this.totalCompressed += entry.compressedBytes;
    if (this.total > l.maxTotalUncompressedBytes) {
      throw new ArchiveBombError(
        "TOTAL_SIZE_EXCEEDED",
        `uncompressed total exceeds ${l.maxTotalUncompressedBytes} bytes`,
      );
    }
    const ratio =
      entry.compressedBytes > 0
        ? entry.uncompressedBytes / entry.compressedBytes
        : entry.uncompressedBytes > 0
          ? Infinity
          : 0;
    const overall =
      this.totalCompressed > 0 ? this.total / this.totalCompressed : 0;
    if (ratio > l.maxCompressionRatio || overall > l.maxCompressionRatio) {
      throw new ArchiveBombError(
        "RATIO_EXCEEDED",
        `compression ratio exceeds ${l.maxCompressionRatio}`,
      );
    }
  }

  validate(entries: BombCheckEntry[]): void {
    for (const e of entries) this.check(e);
  }
}
