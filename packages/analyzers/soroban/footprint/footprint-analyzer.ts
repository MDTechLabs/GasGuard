/**
 * Issue #893 — Soroban Footprint Analyzer
 *
 * Detects duplicate, redundant, and unnecessary entries in Soroban transaction
 * footprints. Analyzes read/write access patterns and provides optimization
 * suggestions to reduce transaction complexity and fees.
 */

import {
  maskNonCode,
  createLineResolver,
  normalizeExpr,
} from "../common/source-utils";

export type Severity = "high" | "medium" | "low" | "info";
export type AccessType = "read" | "write" | "read-write";

export interface FootprintEntry {
  key: string;
  accessType: AccessType;
  line: number;
  offset: number;
  isDuplicate: boolean;
  duplicateOf?: string;
}

export interface RedundantFootprintFinding {
  ruleId: string;
  severity: Severity;
  line: number;
  message: string;
  suggestion: string;
  patternId: string;
  entry?: FootprintEntry;
}

export interface FootprintAnalysisReport {
  findings: RedundantFootprintFinding[];
  entries: FootprintEntry[];
  duplicates: FootprintEntry[];
  unusedEntries: FootprintEntry[];
  readEntries: FootprintEntry[];
  writeEntries: FootprintEntry[];
  summary: string;
  metrics: {
    totalEntries: number;
    duplicateEntries: number;
    unusedEntries: number;
    readOnlyEntries: number;
    readWriteEntries: number;
  };
}

const STORAGE_READ_REGEX =
  /\bstorage\s*\(\s*\)\s*\.\s*(instance|persistent|temporary)\s*\(\s*\)\s*\.\s*(get|has|get_unchecked)\s*\(\s*([^)]*)\)/g;
const STORAGE_WRITE_REGEX =
  /\bstorage\s*\(\s*\)\s*\.\s*(instance|persistent|temporary)\s*\(\s*\)\s*\.\s*(set|put|extend_ttl)\s*\(\s*([^,)]*)/g;

export function analyzeFootprint(source: string): FootprintAnalysisReport {
  const findings: RedundantFootprintFinding[] = [];
  const entries: FootprintEntry[] = [];
  const masked = maskNonCode(source);
  const lineOf = createLineResolver(source);

  const storageKeys = new Map<
    string,
    { accessType: AccessType; line: number; offset: number; count: number }
  >();

  let match: RegExpExecArray | null;

  const readRe = new RegExp(STORAGE_READ_REGEX.source, "g");
  while ((match = readRe.exec(masked)) !== null) {
    const offset = match.index;
    const line = lineOf(offset);
    const rawKey = match[3] || "unknown";
    const key = normalizeExpr(rawKey);

    const existing = storageKeys.get(key);
    if (existing) {
      if (existing.accessType === "write") {
        existing.accessType = "read-write";
      }
      existing.count++;
    } else {
      storageKeys.set(key, { accessType: "read", line, offset, count: 1 });
    }
  }

  const writeRe = new RegExp(STORAGE_WRITE_REGEX.source, "g");
  while ((match = writeRe.exec(masked)) !== null) {
    const offset = match.index;
    const line = lineOf(offset);
    const rawKey = match[3] || "unknown";
    const key = normalizeExpr(rawKey);

    const existing = storageKeys.get(key);
    if (existing) {
      if (existing.accessType === "read") {
        existing.accessType = "read-write";
      }
      existing.count++;
    } else {
      storageKeys.set(key, { accessType: "write", line, offset, count: 1 });
    }
  }

  for (const [key, data] of storageKeys) {
    entries.push({
      key,
      accessType: data.accessType,
      line: data.line,
      offset: data.offset,
      isDuplicate: false,
    });
  }

  const duplicates: FootprintEntry[] = [];
  for (const entry of entries) {
    const data = storageKeys.get(entry.key)!;
    if (data.count > 1) {
      entry.isDuplicate = true;
      entry.duplicateOf = entry.key;
      duplicates.push(entry);

      findings.push({
        ruleId: "soroban-footprint-duplicate-entry",
        severity: "medium",
        line: entry.line,
        message: `Duplicate footprint entry detected for key '${entry.key}' (${data.count} accesses).`,
        suggestion: `Remove duplicate access for '${entry.key}' to reduce transaction complexity and fees.`,
        patternId: "duplicate-entry",
        entry,
      });
    }
  }

  const unusedEntries: FootprintEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDuplicate) {
      unusedEntries.push(entry);
      findings.push({
        ruleId: "soroban-footprint-unused-entry",
        severity: "low",
        line: entry.line,
        message: `Footprint entry '${entry.key}' is accessed only once.`,
        suggestion: `Review if entry '${entry.key}' is necessary. Remove unused entries to reduce footprint size.`,
        patternId: "unused-entry",
        entry,
      });
    }
  }

  const readEntries = entries.filter((e) => e.accessType === "read");
  const writeEntries = entries.filter(
    (e) => e.accessType === "write" || e.accessType === "read-write",
  );

  if (duplicates.length > 0) {
    findings.push({
      ruleId: "soroban-footprint-optimization",
      severity: "info",
      line: 0,
      message: `Found ${duplicates.length} duplicate footprint entries that can be removed.`,
      suggestion:
        "Consolidate duplicate footprint entries to reduce transaction size and improve performance.",
      patternId: "optimization-suggestion",
    });
  }

  const totalEntries = entries.length;
  const duplicateCount = duplicates.length;
  const unusedCount = unusedEntries.length;
  const readOnlyCount = readEntries.length;
  const readWriteCount = writeEntries.length;

  let summary: string;
  if (totalEntries === 0) {
    summary = "No footprint entries detected in the source code.";
  } else if (duplicateCount === 0) {
    summary = `Analyzed ${totalEntries} footprint entries. No redundant entries detected.`;
  } else {
    summary = `Analyzed ${totalEntries} footprint entries. Found ${duplicateCount} duplicate(s).`;
  }

  return {
    findings,
    entries,
    duplicates,
    unusedEntries,
    readEntries,
    writeEntries,
    summary,
    metrics: {
      totalEntries,
      duplicateEntries: duplicateCount,
      unusedEntries: unusedCount,
      readOnlyEntries: readOnlyCount,
      readWriteEntries: readWriteCount,
    },
  };
}

export function analyzeFootprintObject(footprint: {
  readOnly: string[];
  readWrite: string[];
}): FootprintAnalysisReport {
  const findings: RedundantFootprintFinding[] = [];
  const entries: FootprintEntry[] = [];
  const duplicates: FootprintEntry[] = [];
  const unusedEntries: FootprintEntry[] = [];

  const readOnlyKeyMap = new Map<string, number[]>();
  for (let i = 0; i < footprint.readOnly.length; i++) {
    const key = footprint.readOnly[i];
    const indices = readOnlyKeyMap.get(key) || [];
    indices.push(i);
    readOnlyKeyMap.set(key, indices);
  }

  const readWriteKeyMap = new Map<string, number[]>();
  for (let i = 0; i < footprint.readWrite.length; i++) {
    const key = footprint.readWrite[i];
    const indices = readWriteKeyMap.get(key) || [];
    indices.push(i);
    readWriteKeyMap.set(key, indices);
  }

  for (const [key, indices] of readOnlyKeyMap) {
    for (let i = 0; i < indices.length; i++) {
      const entry: FootprintEntry = {
        key,
        accessType: "read",
        line: 0,
        offset: 0,
        isDuplicate: i > 0,
        duplicateOf: i > 0 ? key : undefined,
      };
      entries.push(entry);

      if (i > 0) {
        duplicates.push(entry);
        findings.push({
          ruleId: "soroban-footprint-duplicate-entry",
          severity: "medium",
          line: 0,
          message: `Duplicate read-only footprint entry detected for key '${key}'.`,
          suggestion: `Remove duplicate entry for '${key}' to reduce transaction complexity.`,
          patternId: "duplicate-entry",
          entry,
        });
      }
    }
  }

  for (const [key, indices] of readWriteKeyMap) {
    for (let i = 0; i < indices.length; i++) {
      const entry: FootprintEntry = {
        key,
        accessType: "read-write",
        line: 0,
        offset: 0,
        isDuplicate: i > 0,
        duplicateOf: i > 0 ? key : undefined,
      };
      entries.push(entry);

      if (i > 0) {
        duplicates.push(entry);
        findings.push({
          ruleId: "soroban-footprint-duplicate-entry",
          severity: "medium",
          line: 0,
          message: `Duplicate read-write footprint entry detected for key '${key}'.`,
          suggestion: `Remove duplicate entry for '${key}' to reduce transaction complexity.`,
          patternId: "duplicate-entry",
          entry,
        });
      }
    }
  }

  const overlapKeys = new Set<string>();
  for (const [key] of readOnlyKeyMap) {
    if (readWriteKeyMap.has(key)) {
      overlapKeys.add(key);
    }
  }

  for (const key of overlapKeys) {
    findings.push({
      ruleId: "soroban-footprint-overlapping-access",
      severity: "medium",
      line: 0,
      message: `Key '${key}' appears in both readOnly and readWrite footprint entries.`,
      suggestion: `Consolidate '${key}' to readWrite only if it's modified, or readOnly if it's only read.`,
      patternId: "overlapping-access",
    });
  }

  const readEntries = entries.filter((e) => e.accessType === "read");
  const writeEntries = entries.filter(
    (e) => e.accessType === "write" || e.accessType === "read-write",
  );

  const totalEntries = entries.length;
  const duplicateCount = duplicates.length;
  const readOnlyCount = footprint.readOnly.length;
  const readWriteCount = footprint.readWrite.length;

  let summary: string;
  if (totalEntries === 0) {
    summary = "Empty footprint with no entries.";
  } else if (duplicateCount === 0) {
    summary = `Analyzed ${totalEntries} footprint entries (${readOnlyCount} read-only, ${readWriteCount} read-write). No redundant entries detected.`;
  } else {
    summary = `Analyzed ${totalEntries} footprint entries. Found ${duplicateCount} duplicate(s).`;
  }

  return {
    findings,
    entries,
    duplicates,
    unusedEntries,
    readEntries,
    writeEntries,
    summary,
    metrics: {
      totalEntries,
      duplicateEntries: duplicateCount,
      unusedEntries: unusedEntries.length,
      readOnlyEntries: readOnlyCount,
      readWriteEntries: readWriteCount,
    },
  };
}
