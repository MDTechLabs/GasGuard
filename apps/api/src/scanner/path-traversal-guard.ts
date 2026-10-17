/**
 * Repository path traversal guard (#1098).
 *
 * Every path that comes from a repository entry (archive member name, manifest
 * reference, ignore-file entry) is resolved through this guard before it is
 * read or written. The guard rejects absolute paths, Windows drive paths,
 * parent-directory segments, null bytes and control characters, and finally
 * verifies the resolved path still lives under the repository root.
 *
 * The guard is pure: it never touches the filesystem, so it can be applied to
 * entries before they are extracted.
 */

import * as path from "path";

export class PathTraversalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathTraversalError";
  }
}

const DRIVE_PATH = /^[A-Za-z]:[\\/]/;

/** Resolve `entryPath` against `rootDir`, rejecting anything that escapes it. */
export function resolveRepositoryPath(rootDir: string, entryPath: string): string {
  if (typeof rootDir !== "string" || rootDir.trim() === "") {
    throw new PathTraversalError("rootDir must be a non-empty string");
  }
  if (typeof entryPath !== "string" || entryPath.trim() === "") {
    throw new PathTraversalError("entryPath must be a non-empty string");
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(entryPath)) {
    throw new PathTraversalError(`entryPath contains control characters: ${entryPath}`);
  }
  if (path.isAbsolute(entryPath) || DRIVE_PATH.test(entryPath)) {
    throw new PathTraversalError(`absolute paths are not allowed: ${entryPath}`);
  }

  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, entryPath);
  const relative = path.relative(root, resolved);

  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PathTraversalError(`path escapes the repository root: ${entryPath}`);
  }

  return resolved;
}

/** True when `entryPath` may be read from `rootDir`. */
export function isSafeRepositoryPath(rootDir: string, entryPath: string): boolean {
  try {
    resolveRepositoryPath(rootDir, entryPath);
    return true;
  } catch {
    return false;
  }
}
