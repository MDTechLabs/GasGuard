/**
 * Rule pack dependency lockfile support.
 *
 * A lockfile pins the exact version of every rule pack and its transitive
 * dependencies so that two scans against the same commit produce byte-identical
 * findings regardless of when or where they run.
 *
 * Design notes
 * ──────────────
 * - Pure: no I/O, no global state, no clocks.  File reading is the caller's
 *   responsibility; the module accepts already-parsed objects.
 * - Tenant-isolated: every lockfile instance is independent; no shared singleton.
 * - Deterministic: serialisation sorts all keys and entries before writing so
 *   the file does not churn on re-lock of an unchanged dependency set.
 * - Backward-compatible: unknown top-level keys in a parsed lockfile are
 *   preserved as `extra` so future versions do not silently drop data.
 */

export const LOCKFILE_SCHEMA_VERSION = 1;
export const LOCKFILE_FILENAME = "gasguard.lock";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface LockedPackEntry {
  /** Exact resolved version, e.g. "2.3.1". */
  version: string;
  /**
   * Content-hash of the pack at that version (SHA-256, hex, 64 chars).
   * A missing hash is accepted on read but written as "" so callers can
   * detect stale or incomplete entries.
   */
  integrity: string;
  /** Names of other locked packs this entry depends on. */
  dependencies: string[];
  /** ISO-8601 timestamp when the entry was last resolved. */
  resolvedAt: string;
}

export interface RulePackLockfile {
  schemaVersion: number;
  /** ISO-8601 timestamp of the most recent `lock` call. */
  lockedAt: string;
  /** Sorted map of pack-name → locked entry. */
  packs: Record<string, LockedPackEntry>;
  /**
   * Unknown top-level keys from a parsed file; preserved so round-tripping
   * an older or newer lockfile never discards data.
   */
  extra?: Record<string, unknown>;
}

export type LockfileIssueCode =
  | "MALFORMED_LOCKFILE"
  | "UNKNOWN_SCHEMA_VERSION"
  | "MISSING_PACK_ENTRY"
  | "VERSION_MISMATCH"
  | "INTEGRITY_MISMATCH"
  | "MISSING_DEPENDENCY"
  | "CIRCULAR_DEPENDENCY"
  | "INVALID_ENTRY";

export interface LockfileIssue {
  code: LockfileIssueCode;
  message: string;
  pack?: string;
  /** True when the issue causes the lockfile to be treated as invalid. */
  fatal: boolean;
}

export interface LockfileParseResult {
  lockfile: RulePackLockfile | undefined;
  issues: LockfileIssue[];
  valid: boolean;
}

export interface LockfileValidationResult {
  valid: boolean;
  issues: LockfileIssue[];
}

/** Minimal descriptor required to lock a rule pack. */
export interface RulePackDescriptor {
  name: string;
  version: string;
  /** SHA-256 hex hash of the pack contents.  May be "" when not yet computed. */
  integrity?: string;
  /** Names of other packs this one depends on. */
  dependencies?: string[];
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Parses a raw JSON-decoded object (or string) into a `RulePackLockfile`.
 *
 * Never throws.  All structural problems are returned as issues.
 */
export function parseLockfile(raw: unknown): LockfileParseResult {
  const issues: LockfileIssue[] = [];

  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      issues.push({
        code: "MALFORMED_LOCKFILE",
        message: "Lockfile content is not valid JSON.",
        fatal: true,
      });
      return { lockfile: undefined, issues, valid: false };
    }
  }

  if (!isRecord(raw)) {
    issues.push({
      code: "MALFORMED_LOCKFILE",
      message: "Lockfile root must be a JSON object.",
      fatal: true,
    });
    return { lockfile: undefined, issues, valid: false };
  }

  const { schemaVersion, lockedAt, packs, ...rest } = raw as Record<string, unknown>;

  if (typeof schemaVersion !== "number" || schemaVersion !== LOCKFILE_SCHEMA_VERSION) {
    issues.push({
      code: "UNKNOWN_SCHEMA_VERSION",
      message: `Unsupported lockfile schemaVersion: ${String(schemaVersion)}. Expected ${LOCKFILE_SCHEMA_VERSION}.`,
      fatal: true,
    });
    return { lockfile: undefined, issues, valid: false };
  }

  const lockedAtStr =
    typeof lockedAt === "string" && lockedAt.trim() !== ""
      ? lockedAt.trim()
      : new Date(0).toISOString();

  const parsedPacks: Record<string, LockedPackEntry> = {};

  if (!isRecord(packs)) {
    issues.push({
      code: "MALFORMED_LOCKFILE",
      message: "Lockfile `packs` field must be an object.",
      fatal: true,
    });
    return { lockfile: undefined, issues, valid: false };
  }

  for (const [name, rawEntry] of Object.entries(packs)) {
    if (!isRecord(rawEntry)) {
      issues.push({
        code: "INVALID_ENTRY",
        message: `Pack entry "${name}" is not an object.`,
        pack: name,
        fatal: false,
      });
      continue;
    }

    const version =
      typeof rawEntry.version === "string" ? rawEntry.version.trim() : "";
    const integrity =
      typeof rawEntry.integrity === "string" ? rawEntry.integrity.trim() : "";
    const dependencies = Array.isArray(rawEntry.dependencies)
      ? rawEntry.dependencies.filter((d): d is string => typeof d === "string")
      : [];
    const resolvedAt =
      typeof rawEntry.resolvedAt === "string" && rawEntry.resolvedAt.trim() !== ""
        ? rawEntry.resolvedAt.trim()
        : new Date(0).toISOString();

    if (version === "") {
      issues.push({
        code: "INVALID_ENTRY",
        message: `Pack entry "${name}" is missing a version.`,
        pack: name,
        fatal: false,
      });
      continue;
    }

    parsedPacks[name] = { version, integrity, dependencies, resolvedAt };
  }

  const extra = Object.keys(rest).length > 0 ? rest : undefined;

  const lockfile: RulePackLockfile = {
    schemaVersion: LOCKFILE_SCHEMA_VERSION,
    lockedAt: lockedAtStr,
    packs: parsedPacks,
    ...(extra !== undefined ? { extra } : {}),
  };

  return { lockfile, issues, valid: issues.every((i) => !i.fatal) };
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validates a parsed lockfile against a set of requested pack descriptors.
 *
 * Returns issues for:
 *  - packs required by the caller that are absent from the lockfile
 *  - version mismatches between the lockfile and the requested descriptor
 *  - integrity mismatches (when both sides supply a non-empty hash)
 *  - declared dependencies that are not present in the lockfile
 *  - circular dependency chains
 */
export function validateLockfile(
  lockfile: RulePackLockfile,
  requested: RulePackDescriptor[],
): LockfileValidationResult {
  const issues: LockfileIssue[] = [];

  for (const req of requested) {
    const entry = lockfile.packs[req.name];
    if (!entry) {
      issues.push({
        code: "MISSING_PACK_ENTRY",
        message: `Rule pack "${req.name}" is not present in the lockfile. Run gasguard lock to regenerate it.`,
        pack: req.name,
        fatal: true,
      });
      continue;
    }

    if (entry.version !== req.version) {
      issues.push({
        code: "VERSION_MISMATCH",
        message:
          `Rule pack "${req.name}" version mismatch: lockfile has "${entry.version}", requested "${req.version}".`,
        pack: req.name,
        fatal: true,
      });
    }

    if (
      req.integrity &&
      req.integrity !== "" &&
      entry.integrity !== "" &&
      entry.integrity !== req.integrity
    ) {
      issues.push({
        code: "INTEGRITY_MISMATCH",
        message:
          `Rule pack "${req.name}" integrity mismatch: lockfile has "${entry.integrity}", got "${req.integrity}".`,
        pack: req.name,
        fatal: true,
      });
    }
  }

  // Dependency completeness: every declared dep must itself be in the lockfile.
  for (const [name, entry] of Object.entries(lockfile.packs)) {
    for (const dep of entry.dependencies) {
      if (!lockfile.packs[dep]) {
        issues.push({
          code: "MISSING_DEPENDENCY",
          message: `Rule pack "${name}" depends on "${dep}", which is not in the lockfile.`,
          pack: name,
          fatal: true,
        });
      }
    }
  }

  // Cycle detection via DFS.
  const cycleIssues = detectDependencyCycles(lockfile.packs);
  issues.push(...cycleIssues);

  return { valid: issues.every((i) => !i.fatal), issues };
}

function detectDependencyCycles(
  packs: Record<string, LockedPackEntry>,
): LockfileIssue[] {
  const issues: LockfileIssue[] = [];
  const visited = new Set<string>();
  const path: string[] = [];

  const visit = (name: string): void => {
    if (path.includes(name)) {
      const cycle = [...path.slice(path.indexOf(name)), name];
      issues.push({
        code: "CIRCULAR_DEPENDENCY",
        message: `Circular rule pack dependency detected: ${cycle.join(" → ")}.`,
        pack: name,
        fatal: true,
      });
      return;
    }
    if (visited.has(name)) return;
    path.push(name);
    for (const dep of packs[name]?.dependencies ?? []) {
      visit(dep);
    }
    path.pop();
    visited.add(name);
  };

  for (const name of Object.keys(packs)) visit(name);
  return issues;
}

// ─── Locking (generation) ─────────────────────────────────────────────────────

/**
 * Produces a new lockfile from a set of resolved pack descriptors.
 *
 * `now` is injectable so tests can pin the timestamp.
 */
export function generateLockfile(
  packs: RulePackDescriptor[],
  now: () => string = () => new Date().toISOString(),
): RulePackLockfile {
  const timestamp = now();
  const entries: Record<string, LockedPackEntry> = {};

  for (const pack of packs) {
    entries[pack.name] = {
      version: pack.version,
      integrity: pack.integrity ?? "",
      dependencies: [...(pack.dependencies ?? [])].sort(),
      resolvedAt: timestamp,
    };
  }

  // Sort packs deterministically.
  const sortedEntries = Object.fromEntries(
    Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)),
  );

  return {
    schemaVersion: LOCKFILE_SCHEMA_VERSION,
    lockedAt: timestamp,
    packs: sortedEntries,
  };
}

// ─── Serialisation ────────────────────────────────────────────────────────────

/**
 * Serialises a lockfile to a formatted JSON string.
 *
 * Keys are sorted at every level so the output is byte-identical for the same
 * logical content, making VCS diffs minimal.
 */
export function serializeLockfile(lockfile: RulePackLockfile): string {
  const { extra, ...rest } = lockfile;
  const obj: Record<string, unknown> = {
    schemaVersion: rest.schemaVersion,
    lockedAt: rest.lockedAt,
    packs: Object.fromEntries(
      Object.entries(rest.packs)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, entry]) => [
          name,
          {
            version: entry.version,
            integrity: entry.integrity,
            dependencies: [...entry.dependencies].sort(),
            resolvedAt: entry.resolvedAt,
          },
        ]),
    ),
    ...(extra ?? {}),
  };
  return JSON.stringify(obj, null, 2) + "\n";
}
