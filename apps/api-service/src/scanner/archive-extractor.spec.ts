import {
  sanitiseEntryPath,
  parseZipEntries,
  validateArchiveBuffer,
  DEFAULT_ARCHIVE_LIMITS,
} from "./archive-extractor";
import type { ArchiveSizeLimits } from "./interfaces/scanner.interface";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Builds a minimal valid ZIP local file header for a single entry. */
function buildZipBuffer(entries: Array<{ path: string; compressedSize: number; uncompressedSize: number }>): Buffer {
  const bufs: Buffer[] = [];
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.path, "utf8");
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);  // local file header signature
    header.writeUInt16LE(20, 4);          // version needed
    header.writeUInt16LE(0, 6);           // general purpose bit flag
    header.writeUInt16LE(0, 8);           // compression method
    header.writeUInt32LE(entry.compressedSize, 18);
    header.writeUInt32LE(entry.uncompressedSize, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28);          // extra field length

    const data = Buffer.alloc(entry.compressedSize);
    bufs.push(header, nameBuf, data);
  }
  return Buffer.concat(bufs);
}

const LENIENT_LIMITS: ArchiveSizeLimits = {
  maxArchiveBytes: 100 * 1024 * 1024,
  maxTotalUncompressedBytes: 500 * 1024 * 1024,
  maxEntryBytes: 50 * 1024 * 1024,
  maxEntryCount: 100_000,
  maxCompressionRatio: 1000,
  maxPathDepth: 50,
};

const ONE_KB = 1024;
const fixedClock = (() => {
  let t = 1000;
  return () => (t += 5);
})();

// ─── sanitiseEntryPath ────────────────────────────────────────────────────────

describe("sanitiseEntryPath", () => {
  it("returns simple relative paths unchanged (forward slash)", () => {
    expect(sanitiseEntryPath("src/main.ts", 10)).toBe("src/main.ts");
  });

  it("normalises Windows back-slashes", () => {
    expect(sanitiseEntryPath("src\\main.ts", 10)).toBe("src/main.ts");
  });

  it("collapses redundant dots and empty segments", () => {
    expect(sanitiseEntryPath("./a//b/./c.ts", 10)).toBe("a/b/c.ts");
  });

  it("returns null for absolute Unix paths", () => {
    expect(sanitiseEntryPath("/etc/passwd", 10)).toBeNull();
  });

  it("returns null for absolute Windows paths", () => {
    expect(sanitiseEntryPath("C:/Windows/System32/evil.dll", 10)).toBeNull();
  });

  it("returns null for path-traversal attempts (Zip Slip)", () => {
    expect(sanitiseEntryPath("../../etc/passwd", 10)).toBeNull();
    expect(sanitiseEntryPath("safe/../../../outside.txt", 10)).toBeNull();
  });

  it("returns null for paths exceeding maxDepth", () => {
    const deep = Array.from({ length: 25 }, (_, i) => `d${i}`).join("/") + "/file.ts";
    expect(sanitiseEntryPath(deep, 20)).toBeNull();
  });

  it("returns null for empty or whitespace-only paths", () => {
    expect(sanitiseEntryPath("", 10)).toBeNull();
    expect(sanitiseEntryPath("   ", 10)).toBeNull();
  });

  it("accepts paths at exactly maxDepth", () => {
    const exact = Array.from({ length: 5 }, (_, i) => `d${i}`).join("/") + "/file.ts";
    expect(sanitiseEntryPath(exact, 6)).toBe(exact);
  });
});

// ─── parseZipEntries ──────────────────────────────────────────────────────────

describe("parseZipEntries", () => {
  it("parses a buffer with a single valid entry", () => {
    const buf = buildZipBuffer([{ path: "src/main.ts", compressedSize: 100, uncompressedSize: 200 }]);
    const entries = parseZipEntries(buf);

    expect(entries).not.toBeNull();
    expect(entries!).toHaveLength(1);
    expect(entries![0]!.path).toBe("src/main.ts");
    expect(entries![0]!.uncompressedSize).toBe(200);
  });

  it("parses a buffer with multiple entries", () => {
    const buf = buildZipBuffer([
      { path: "a.ts", compressedSize: 10, uncompressedSize: 20 },
      { path: "b.ts", compressedSize: 30, uncompressedSize: 60 },
    ]);
    const entries = parseZipEntries(buf);

    expect(entries).toHaveLength(2);
  });

  it("returns null for an empty buffer", () => {
    expect(parseZipEntries(Buffer.alloc(0))).toBeNull();
  });

  it("returns null for a buffer that is not a ZIP", () => {
    const notZip = Buffer.from("this is not a zip file at all");
    expect(parseZipEntries(notZip)).toBeNull();
  });
});

// ─── validateArchiveBuffer — normal scenarios ─────────────────────────────────

describe("validateArchiveBuffer — normal scenarios", () => {
  it("returns valid=true for a clean single-entry ZIP within all limits", () => {
    const buf = buildZipBuffer([{ path: "src/index.ts", compressedSize: 100, uncompressedSize: 200 }]);
    const result = validateArchiveBuffer(buf, LENIENT_LIMITS, fixedClock);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.entryCount).toBe(1);
    expect(result.archiveBytes).toBe(buf.length);
  });

  it("returns ARCHIVE_INVALID_FORMAT for a non-ZIP buffer", () => {
    const buf = Buffer.from("not a zip");
    const result = validateArchiveBuffer(buf, LENIENT_LIMITS, fixedClock);

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.code).toBe("ARCHIVE_INVALID_FORMAT");
  });
});

// ─── validateArchiveBuffer — boundary / failure scenarios ─────────────────────

describe("validateArchiveBuffer — boundary and failure scenarios", () => {
  it("rejects an archive that exceeds maxArchiveBytes", () => {
    const buf = buildZipBuffer([{ path: "big.bin", compressedSize: 1000, uncompressedSize: 1000 }]);
    const tightLimits: ArchiveSizeLimits = { ...DEFAULT_ARCHIVE_LIMITS, maxArchiveBytes: 1 };
    const result = validateArchiveBuffer(buf, tightLimits, fixedClock);

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.code).toBe("ARCHIVE_TOO_LARGE");
  });

  it("rejects an archive with too many entries", () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({
      path: `file${i}.ts`,
      compressedSize: 10,
      uncompressedSize: 20,
    }));
    const buf = buildZipBuffer(entries);
    const tightLimits: ArchiveSizeLimits = { ...LENIENT_LIMITS, maxEntryCount: 3 };
    const result = validateArchiveBuffer(buf, tightLimits, fixedClock);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "ARCHIVE_TOO_MANY_ENTRIES")).toBe(true);
  });

  it("rejects an entry that is individually too large", () => {
    const buf = buildZipBuffer([{ path: "huge.ts", compressedSize: ONE_KB, uncompressedSize: 100 * ONE_KB }]);
    const tightLimits: ArchiveSizeLimits = { ...LENIENT_LIMITS, maxEntryBytes: 50 * ONE_KB };
    const result = validateArchiveBuffer(buf, tightLimits, fixedClock);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "ARCHIVE_ENTRY_TOO_LARGE" && e.entryPath === "huge.ts")).toBe(true);
  });

  it("rejects when total uncompressed bytes exceeds the limit", () => {
    const entries = Array.from({ length: 3 }, (_, i) => ({
      path: `file${i}.ts`,
      compressedSize: ONE_KB,
      uncompressedSize: 100 * ONE_KB,
    }));
    const buf = buildZipBuffer(entries);
    const tightLimits: ArchiveSizeLimits = { ...LENIENT_LIMITS, maxTotalUncompressedBytes: 200 * ONE_KB };
    const result = validateArchiveBuffer(buf, tightLimits, fixedClock);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "ARCHIVE_UNCOPRESSED_TOO_LARGE")).toBe(true);
  });

  it("rejects a zip bomb via compression ratio", () => {
    // Simulates 1 byte compressed → 1000 bytes uncompressed (ratio = 1000)
    const buf = buildZipBuffer([{ path: "bomb.ts", compressedSize: 1, uncompressedSize: 10_000 }]);
    const tightLimits: ArchiveSizeLimits = { ...LENIENT_LIMITS, maxCompressionRatio: 50 };
    const result = validateArchiveBuffer(buf, tightLimits, fixedClock);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "ARCHIVE_COMPRESSION_RATIO_EXCEEDED")).toBe(true);
  });

  it("rejects entries with path-traversal attempts", () => {
    const buf = buildZipBuffer([{ path: "../../etc/passwd", compressedSize: 10, uncompressedSize: 10 }]);
    const result = validateArchiveBuffer(buf, LENIENT_LIMITS, fixedClock);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "ARCHIVE_PATH_TOO_DEEP")).toBe(true);
  });

  it("rejects entries deeper than maxPathDepth", () => {
    const deep = Array.from({ length: 30 }, (_, i) => `d${i}`).join("/") + "/file.ts";
    const buf = buildZipBuffer([{ path: deep, compressedSize: 10, uncompressedSize: 10 }]);
    const tightLimits: ArchiveSizeLimits = { ...LENIENT_LIMITS, maxPathDepth: 5 };
    const result = validateArchiveBuffer(buf, tightLimits, fixedClock);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "ARCHIVE_PATH_TOO_DEEP")).toBe(true);
  });

  it("accumulates multiple independent errors in one pass", () => {
    const entries = [
      { path: "../../traversal", compressedSize: 10, uncompressedSize: 200 * ONE_KB },
      { path: "ok.ts", compressedSize: 10, uncompressedSize: 200 * ONE_KB },
    ];
    const buf = buildZipBuffer(entries);
    const tightLimits: ArchiveSizeLimits = {
      ...LENIENT_LIMITS,
      maxEntryBytes: 100 * ONE_KB,
      maxTotalUncompressedBytes: 300 * ONE_KB,
    };
    const result = validateArchiveBuffer(buf, tightLimits, fixedClock);

    // At least ARCHIVE_ENTRY_TOO_LARGE, ARCHIVE_PATH_TOO_DEEP.
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("reports correct metrics even when validation fails", () => {
    const entries = [
      { path: "a.ts", compressedSize: 100, uncompressedSize: 200 },
      { path: "b.ts", compressedSize: 100, uncompressedSize: 200 },
    ];
    const buf = buildZipBuffer(entries);
    const tightLimits: ArchiveSizeLimits = { ...LENIENT_LIMITS, maxEntryCount: 1 };
    const result = validateArchiveBuffer(buf, tightLimits, fixedClock);

    expect(result.entryCount).toBe(2);
    expect(result.totalUncompressedBytes).toBe(400);
  });

  it("validationDurationMs is non-negative", () => {
    const buf = buildZipBuffer([{ path: "f.ts", compressedSize: 10, uncompressedSize: 20 }]);
    const result = validateArchiveBuffer(buf, LENIENT_LIMITS, fixedClock);

    expect(result.validationDurationMs).toBeGreaterThanOrEqual(0);
  });
});
