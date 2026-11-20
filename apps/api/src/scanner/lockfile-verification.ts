/**
 * Dependency lockfile verification (#1349).
 *
 * Run before any package manager is invoked on an untrusted repository. The
 * check is pure (it takes file contents) and never executes anything. It
 * verifies that an npm `package-lock.json` exists, parses, covers every
 * dependency declared in `package.json`, and pins each resolved package to an
 * https URL with an integrity hash.
 */

export interface LockfileVerification {
  ok: boolean;
  problems: string[];
}

const DEP_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"] as const;

export function verifyLockfile(packageJsonText: string, lockfileText: string | undefined): LockfileVerification {
  const problems: string[] = [];
  if (lockfileText === undefined || lockfileText.trim() === "") {
    return { ok: false, problems: ["lockfile is missing"] };
  }

  let manifest: Record<string, Record<string, string> | undefined>;
  let lock: { lockfileVersion?: number; packages?: Record<string, { resolved?: string; integrity?: string; link?: boolean }> };
  try {
    manifest = JSON.parse(packageJsonText);
    lock = JSON.parse(lockfileText);
  } catch {
    return { ok: false, problems: ["package.json or lockfile is not valid JSON"] };
  }

  if (typeof lock.lockfileVersion !== "number" || lock.lockfileVersion < 2 || !lock.packages) {
    return { ok: false, problems: ["lockfile must be npm lockfileVersion 2+ with a packages map"] };
  }

  for (const field of DEP_FIELDS) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (!lock.packages[`node_modules/${name}`]) {
        problems.push(`${name} is declared in package.json but absent from the lockfile`);
      }
    }
  }

  for (const [key, entry] of Object.entries(lock.packages)) {
    if (key === "" || entry.link) continue;
    if (!entry.resolved || !entry.integrity) {
      problems.push(`${key} has no resolved URL or integrity hash`);
    } else if (!entry.resolved.startsWith("https://")) {
      problems.push(`${key} resolves over a non-https URL`);
    }
  }

  return { ok: problems.length === 0, problems };
}

export function assertLockfileVerified(packageJsonText: string, lockfileText: string | undefined): void {
  const result = verifyLockfile(packageJsonText, lockfileText);
  if (!result.ok) {
    throw new Error(`lockfile verification failed: ${result.problems.join("; ")}`);
  }
}
