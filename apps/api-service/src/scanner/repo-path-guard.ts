/**
 * Repository checkout path validation against symlink escapes.
 *
 * Resolves real paths (following symlinks) and rejects any path that ends up
 * outside the checkout root, so an untrusted repository cannot make the
 * scanner read files such as /etc/passwd via a malicious symlink.
 */

import * as fs from "fs";
import * as path from "path";

export class SymlinkEscapeError extends Error {
  constructor(public readonly requested: string, public readonly resolved: string) {
    super(`Path "${requested}" resolves outside the checkout root.`);
    this.name = "SymlinkEscapeError";
  }
}

function isInside(root: string, target: string): boolean {
  return target === root || target.startsWith(root + path.sep);
}

/**
 * Returns the real (symlink-resolved) absolute path of `relativePath` under
 * `checkoutRoot`. Throws SymlinkEscapeError if it escapes the root.
 */
export function resolveInsideCheckout(
  checkoutRoot: string,
  relativePath: string,
): string {
  const realRoot = fs.realpathSync(checkoutRoot);
  const lexical = path.resolve(realRoot, relativePath);
  if (!isInside(realRoot, lexical)) {
    throw new SymlinkEscapeError(relativePath, lexical);
  }
  const real = fs.realpathSync(lexical);
  if (!isInside(realRoot, real)) {
    throw new SymlinkEscapeError(relativePath, real);
  }
  return real;
}

/** Boolean variant: true when the path stays inside the checkout root. */
export function isSafeCheckoutPath(
  checkoutRoot: string,
  relativePath: string,
): boolean {
  try {
    resolveInsideCheckout(checkoutRoot, relativePath);
    return true;
  } catch {
    return false;
  }
}
