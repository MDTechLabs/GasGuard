/**
 * Archive path-traversal guard (Zip Slip / link escape).
 *
 * Pure, dependency-free validation of archive entry names and link targets.
 * Decompression-bomb limits (size / ratio / entry count) are intentionally NOT
 * handled here.
 */

import * as path from "path";

export type ArchiveEntryType = "file" | "directory" | "symlink" | "hardlink";

export interface ArchiveEntryInfo {
  name: string;
  type?: ArchiveEntryType;
  /** Link target for symlink / hardlink entries. */
  linkTarget?: string;
}

export interface ArchivePathViolation {
  entry: string;
  reason:
    | "EMPTY_NAME"
    | "NUL_BYTE"
    | "ABSOLUTE_PATH"
    | "DRIVE_OR_UNC_PREFIX"
    | "PARENT_SEGMENT"
    | "LINK_ESCAPES_ROOT";
}

const DRIVE_RE = /^[A-Za-z]:/;

function nameViolation(name: string): ArchivePathViolation["reason"] | null {
  if (name.trim() === "") return "EMPTY_NAME";
  if (name.includes("\0")) return "NUL_BYTE";
  const p = name.replace(/\\/g, "/");
  if (p.startsWith("//")) return "DRIVE_OR_UNC_PREFIX";
  if (DRIVE_RE.test(p)) return "DRIVE_OR_UNC_PREFIX";
  if (p.startsWith("/")) return "ABSOLUTE_PATH";
  if (p.split("/").includes("..")) return "PARENT_SEGMENT";
  return null;
}

/**
 * Validates one archive entry. Returns a violation, or null when safe.
 * Link targets are resolved relative to the entry's own directory (symlinks)
 * or to the extraction root (hardlinks) and must stay inside the root.
 */
export function validateArchiveEntry(
  entry: ArchiveEntryInfo,
): ArchivePathViolation | null {
  const bad = nameViolation(entry.name);
  if (bad) return { entry: entry.name, reason: bad };

  if (entry.type === "symlink" || entry.type === "hardlink") {
    const target = (entry.linkTarget ?? "").replace(/\\/g, "/");
    if (target === "" || target.includes("\0") || target.startsWith("/") || DRIVE_RE.test(target)) {
      return { entry: entry.name, reason: "LINK_ESCAPES_ROOT" };
    }
    const base =
      entry.type === "symlink"
        ? path.posix.dirname(entry.name.replace(/\\/g, "/"))
        : ".";
    const resolved = path.posix.normalize(path.posix.join(base, target));
    if (resolved === ".." || resolved.startsWith("../")) {
      return { entry: entry.name, reason: "LINK_ESCAPES_ROOT" };
    }
  }
  return null;
}

/** Validates all entries and returns every violation found. */
export function findArchivePathViolations(
  entries: ArchiveEntryInfo[],
): ArchivePathViolation[] {
  const out: ArchivePathViolation[] = [];
  for (const e of entries) {
    const v = validateArchiveEntry(e);
    if (v) out.push(v);
  }
  return out;
}

/**
 * Resolves an entry name to an absolute path under `root`, or returns null if
 * the entry is unsafe or the resolved path would fall outside `root`.
 */
export function safeExtractPath(root: string, entryName: string): string | null {
  if (nameViolation(entryName)) return null;
  const absRoot = path.resolve(root);
  const target = path.resolve(absRoot, entryName.replace(/\\/g, "/"));
  if (target !== absRoot && !target.startsWith(absRoot + path.sep)) return null;
  return target;
}
