/**
 * Hardened archive extraction handler.
 *
 * Defends against known archive-based attack vectors before any byte of an
 * uploaded archive reaches the analysis engine:
 *
 *  • Zip-bomb / decompression-bomb — enforced via maxTotalUncompressedBytes
 *    and maxCompressionRatio.
 *  • Path-traversal (Zip Slip) — every entry path is sanitised; entries that
 *    attempt to escape the target directory are rejected outright.
 *  • Oversized entries — each entry is checked against maxEntryBytes so a
 *    single large file cannot exhaust memory.
 *  • Entry-count bombs — archive members are counted and rejected if they
 *    exceed maxEntryCount.
 *  • Deeply-nested paths — maxPathDepth prevents symlink-chain and inode-
 *    exhaustion attacks.
 *
 * Design
 * ──────
 * - No I/O: the public `validateArchiveBuffer` function works on an in-memory
 *   Buffer so it is testable without a filesystem.
 * - Safe defaults: `DEFAULT_ARCHIVE_LIMITS` are deliberately conservative.
 * - Pure validation result: callers receive a `ArchiveValidationResult` and
 *   decide whether to proceed; this module never writes extracted bytes to disk.
 * - Tenant-isolated: no shared state; every call is independent.
 */

import type {
  ArchiveSizeLimits,
  ArchiveValidationError,
  ArchiveValidationErrorCode,
  ArchiveValidationResult,
} from "./interfaces/scanner.interface";

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_ARCHIVE_LIMITS: Readonly<ArchiveSizeLimits> = {
  /** 50 MB compressed upload limit. */
  maxArchiveBytes: 50 * 1024 * 1024,
  /** 200 MB uncompressed total (zip-bomb guard). */
  maxTotalUncompressedBytes: 200 * 1024 * 1024,
  /** 10 MB per individual entry. */
  maxEntryBytes: 10 * 1024 * 1024,
  /** 10,000 entries (entry-count bomb guard). */
  maxEntryCount: 10_000,
  /** Compression ratio > 100 is almost certainly a bomb (typical zips are < 10). */
  maxCompressionRatio: 100,
  /** Paths deeper than 20 levels are pathological for source repos. */
  maxPathDepth: 20,
};

// ─── Path sanitisation ────────────────────────────────────────────────────────

/**
 * Returns a safe repository-relative path, or `null` when the path attempts
 * to escape the target directory (path-traversal / Zip Slip attack).
 *
 * Rules:
 *  - Absolute paths are rejected.
 *  - Any `..` segment that would escape the archive root is rejected.
 *  - Path depth is capped at `maxDepth`.
 */
export function sanitiseEntryPath(
  rawPath: string,
  maxDepth: number,
): string | null {
  // Normalise separators.
  const p = rawPath.replace(/\\/g, "/").trim();

  if (p === "") return null;

  // Absolute path check (Unix and Windows drive-letter).
  if (p.startsWith("/") || /^[A-Za-z]:\//.test(p)) return null;

  const segments: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (segments.length === 0) return null; // escape attempt
      segments.pop();
    } else {
      segments.push(seg);
    }
  }

  if (segments.length === 0) return null;
  if (segments.length > maxDepth) return null;

  return segments.join("/");
}

// ─── Minimal ZIP parser ───────────────────────────────────────────────────────
//
// A full ZIP library is a significant dependency.  For validation purposes we
// only need the local file headers (signature 0x04034b50) to extract the entry
// name and uncompressed size — we never decompress any data here.

interface ZipEntry {
  path: string;
  compressedSize: number;
  uncompressedSize: number;
}

const ZIP_LOCAL_HEADER_SIG = 0x04034b50;
const ZIP_LOCAL_HEADER_MIN_LEN = 30;

/**
 * Extracts a flat list of entry metadata from a ZIP buffer without
 * decompressing any data.
 *
 * Returns `null` when the buffer does not begin with a valid ZIP local-file
 * header signature (i.e. the archive format is not supported / corrupted).
 */
export function parseZipEntries(buf: Buffer): ZipEntry[] | null {
  if (buf.length < 4) return null;

  // Every valid ZIP starts with a local file header signature.
  if (buf.readUInt32LE(0) !== ZIP_LOCAL_HEADER_SIG) return null;

  const entries: ZipEntry[] = [];
  let offset = 0;

  while (offset + ZIP_LOCAL_HEADER_MIN_LEN <= buf.length) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== ZIP_LOCAL_HEADER_SIG) break;

    const compressedSize = buf.readUInt32LE(offset + 18);
    const uncompressedSize = buf.readUInt32LE(offset + 22);
    const fileNameLength = buf.readUInt16LE(offset + 26);
    const extraFieldLength = buf.readUInt16LE(offset + 28);

    const nameStart = offset + ZIP_LOCAL_HEADER_MIN_LEN;
    const nameEnd = nameStart + fileNameLength;
    if (nameEnd > buf.length) break;

    const path = buf.slice(nameStart, nameEnd).toString("utf8");
    entries.push({ path, compressedSize, uncompressedSize });

    offset = nameEnd + extraFieldLength + compressedSize;
  }

  return entries;
}

// ─── Validation ───────────────────────────────────────────────────────────────

function err(
  code: ArchiveValidationErrorCode,
  message: string,
  opts: Partial<Pick<ArchiveValidationError, "observed" | "limit" | "entryPath">> = {},
): ArchiveValidationError {
  return { code, message, ...opts };
}

/**
 * Validates an archive buffer against the supplied (or default) limits.
 *
 * Currently supports ZIP archives.  Other formats return an
 * `ARCHIVE_INVALID_FORMAT` error in the result — they are never extracted.
 *
 * Never throws; all failure modes are surfaced via `errors` in the result.
 */
export function validateArchiveBuffer(
  buf: Buffer,
  limits: ArchiveSizeLimits = DEFAULT_ARCHIVE_LIMITS,
  now: () => number = () => Date.now(),
): ArchiveValidationResult {
  const started = now();
  const errors: ArchiveValidationError[] = [];

  // 1. Archive size.
  const archiveBytes = buf.length;
  if (archiveBytes > limits.maxArchiveBytes) {
    errors.push(
      err(
        "ARCHIVE_TOO_LARGE",
        `Archive size ${archiveBytes} bytes exceeds the limit of ${limits.maxArchiveBytes} bytes.`,
        { observed: archiveBytes, limit: limits.maxArchiveBytes },
      ),
    );
    // No point parsing further — early exit.
    return {
      valid: false,
      errors,
      archiveBytes,
      totalUncompressedBytes: 0,
      entryCount: 0,
      compressionRatio: 0,
      maxPathDepthObserved: 0,
      validationDurationMs: now() - started,
    };
  }

  // 2. Parse entries.
  const parsed = parseZipEntries(buf);
  if (parsed === null) {
    errors.push(
      err("ARCHIVE_INVALID_FORMAT", "Archive is not a recognised ZIP format or is corrupted."),
    );
    return {
      valid: false,
      errors,
      archiveBytes,
      totalUncompressedBytes: 0,
      entryCount: 0,
      compressionRatio: 0,
      maxPathDepthObserved: 0,
      validationDurationMs: now() - started,
    };
  }

  // 3. Entry-count check.
  if (parsed.length > limits.maxEntryCount) {
    errors.push(
      err(
        "ARCHIVE_TOO_MANY_ENTRIES",
        `Archive contains ${parsed.length} entries, exceeding the limit of ${limits.maxEntryCount}.`,
        { observed: parsed.length, limit: limits.maxEntryCount },
      ),
    );
  }

  // 4. Per-entry checks.
  let totalUncompressedBytes = 0;
  let maxPathDepthObserved = 0;

  for (const entry of parsed) {
    // Path sanitisation / traversal guard.
    const safe = sanitiseEntryPath(entry.path, limits.maxPathDepth);
    const depth = safe ? safe.split("/").length : 0;

    if (safe === null) {
      errors.push(
        err(
          "ARCHIVE_PATH_TOO_DEEP",
          `Entry path "${entry.path}" is invalid or exceeds max depth ${limits.maxPathDepth}.`,
          { entryPath: entry.path, limit: limits.maxPathDepth },
        ),
      );
      continue;
    }

    if (depth > maxPathDepthObserved) maxPathDepthObserved = depth;

    // Per-entry size.
    if (entry.uncompressedSize > limits.maxEntryBytes) {
      errors.push(
        err(
          "ARCHIVE_ENTRY_TOO_LARGE",
          `Entry "${safe}" uncompressed size ${entry.uncompressedSize} bytes exceeds limit ${limits.maxEntryBytes} bytes.`,
          { observed: entry.uncompressedSize, limit: limits.maxEntryBytes, entryPath: safe },
        ),
      );
    }

    totalUncompressedBytes += entry.uncompressedSize;
  }

  // 5. Total uncompressed size.
  if (totalUncompressedBytes > limits.maxTotalUncompressedBytes) {
    errors.push(
      err(
        "ARCHIVE_UNCOPRESSED_TOO_LARGE",
        `Total uncompressed size ${totalUncompressedBytes} bytes exceeds limit ${limits.maxTotalUncompressedBytes} bytes.`,
        { observed: totalUncompressedBytes, limit: limits.maxTotalUncompressedBytes },
      ),
    );
  }

  // 6. Compression ratio (bomb guard).
  const compressionRatio =
    archiveBytes > 0 ? totalUncompressedBytes / archiveBytes : 0;
  if (compressionRatio > limits.maxCompressionRatio) {
    errors.push(
      err(
        "ARCHIVE_COMPRESSION_RATIO_EXCEEDED",
        `Compression ratio ${compressionRatio.toFixed(1)} exceeds the limit of ${limits.maxCompressionRatio}.`,
        { observed: Math.round(compressionRatio), limit: limits.maxCompressionRatio },
      ),
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    archiveBytes,
    totalUncompressedBytes,
    entryCount: parsed.length,
    compressionRatio,
    maxPathDepthObserved,
    validationDurationMs: now() - started,
  };
}
