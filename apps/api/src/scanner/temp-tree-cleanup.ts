/**
 * Secure cleanup of temporary source trees (#1350).
 *
 * `withTempSourceTree` creates a private (0700) temp directory, runs the scan,
 * and always removes the tree afterwards, even when the scan throws. Removal
 * never follows symlinks, overwrites file contents with zeros before unlinking
 * (best effort; not a guarantee on journaling or SSD storage) and never
 * touches anything outside the tree.
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

const MAX_OVERWRITE_BYTES = 16 * 1024 * 1024;

async function wipe(target: string): Promise<void> {
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink()) {
    await fs.unlink(target);
  } else if (stat.isDirectory()) {
    await fs.chmod(target, 0o700).catch(() => undefined);
    for (const name of await fs.readdir(target)) {
      await wipe(path.join(target, name));
    }
    await fs.rmdir(target);
  } else {
    await fs.chmod(target, 0o600).catch(() => undefined);
    if (stat.isFile() && stat.size > 0 && stat.size <= MAX_OVERWRITE_BYTES) {
      await fs.writeFile(target, Buffer.alloc(stat.size)).catch(() => undefined);
    }
    await fs.unlink(target);
  }
}

/** Remove `dir` and everything under it; resolves even if it is already gone. */
export async function secureRemoveTree(dir: string): Promise<void> {
  try {
    await wipe(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export async function withTempSourceTree<T>(
  fn: (dir: string) => Promise<T>,
  prefix = "gasguard-scan-",
): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await fs.chmod(dir, 0o700);
  try {
    return await fn(dir);
  } finally {
    await secureRemoveTree(dir);
  }
}
