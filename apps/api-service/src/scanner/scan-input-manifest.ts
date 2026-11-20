/**
 * Immutable scan input manifest: records the commit, toolchain versions and
 * content digests of every input file so a scan can be reproduced and verified.
 */

import { createHash } from "crypto";

export interface ScanInputFile {
  path: string;
  content: string | Buffer;
}

export interface ScanInputManifest {
  readonly version: 1;
  readonly commit: string;
  readonly toolchain: Readonly<Record<string, string>>;
  readonly toolchainDigest: string;
  readonly files: ReadonlyArray<Readonly<{ path: string; sha256: string }>>;
  /** SHA-256 over commit, toolchainDigest and the sorted file digests. */
  readonly manifestDigest: string;
}

const sha256 = (data: string | Buffer): string =>
  createHash("sha256").update(data).digest("hex");

export function buildScanInputManifest(
  commit: string,
  toolchain: Record<string, string>,
  inputs: ScanInputFile[],
): ScanInputManifest {
  const sortedToolchain = Object.fromEntries(
    Object.entries(toolchain).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  const toolchainDigest = sha256(JSON.stringify(sortedToolchain));
  const files = inputs
    .map((f) => ({ path: f.path.replace(/\\/g, "/"), sha256: sha256(f.content) }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((f) => Object.freeze(f));
  const manifestDigest = sha256(
    JSON.stringify({ commit, toolchainDigest, files }),
  );
  return Object.freeze({
    version: 1 as const,
    commit,
    toolchain: Object.freeze(sortedToolchain),
    toolchainDigest,
    files: Object.freeze(files),
    manifestDigest,
  });
}

/** Re-derives the digest and returns true only if the manifest is untampered. */
export function verifyScanInputManifest(m: ScanInputManifest): boolean {
  const toolchainDigest = sha256(JSON.stringify(m.toolchain));
  const manifestDigest = sha256(
    JSON.stringify({ commit: m.commit, toolchainDigest, files: m.files }),
  );
  return toolchainDigest === m.toolchainDigest && manifestDigest === m.manifestDigest;
}
