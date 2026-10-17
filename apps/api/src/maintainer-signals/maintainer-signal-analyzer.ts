/**
 * Pure analysis core for maintainer change signals: input normalization and the
 * baseline-versus-current comparison. No I/O happens here, so every function is
 * deterministic for its inputs.
 */

import * as crypto from "crypto";
import type { NormalizedSbom } from "../sbom/sbom-types";
import {
  DEFAULT_SIGNAL_SEVERITY,
  MaintainerIdentity,
  MaintainerSignal,
  MaintainerSignalError,
  MaintainerSignalSeverity,
  MaintainerSignalType,
  PackageMaintainerSnapshot,
  PackageRef,
  SEVERITY_RANK,
} from "./maintainer-signal-types";

/** A maintainer as a registry provider reports it, before normalization. */
export interface RawMaintainer {
  handle: string;
  /** Used only to derive a domain digest; discarded during normalization. */
  email?: string;
}

export interface RawPackageMaintainers {
  maintainers: RawMaintainer[];
  publisher?: string;
}

/** Previously observed maintainers for one package of one repository. */
export interface MaintainerBaseline {
  ecosystem: string;
  package: string;
  maintainers: MaintainerIdentity[];
  observedAt: number;
  /** Revision of the job that recorded this baseline. */
  revision: number;
}

export class InvalidMaintainerMetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMaintainerMetadataError";
  }
}

const MAX_HANDLE_LENGTH = 128;
const MAX_PACKAGE_NAME_LENGTH = 214;
const MAX_VERSION_LENGTH = 128;
// Printable, no whitespace; covers npm scopes, crates, and registry handles.
const SAFE_TOKEN = /^[^\s\u0000-\u001f\u007f]+$/;
const ECOSYSTEM_PATTERN = /^[a-z][a-z0-9.+-]{0,31}$/;

export function packageKey(ecosystem: string, name: string): string {
  return `${ecosystem}\u0000${name}`;
}

/**
 * Validate, de-duplicate, and sort a caller-supplied package list. Duplicate
 * `(ecosystem, name)` pairs keep the lexically first version so the result does
 * not depend on input order.
 *
 * @throws MaintainerSignalError INVALID_REQUEST naming the first bad index.
 */
export function normalizePackageRefs(refs: unknown): PackageRef[] {
  if (!Array.isArray(refs)) {
    throw new MaintainerSignalError(
      "INVALID_REQUEST",
      "packages must be an array",
    );
  }
  const byKey = new Map<string, PackageRef>();
  refs.forEach((raw, index) => {
    const ref = raw as Partial<PackageRef> | null;
    const ecosystem =
      typeof ref?.ecosystem === "string"
        ? ref.ecosystem.trim().toLowerCase()
        : "";
    const name = typeof ref?.name === "string" ? ref.name.trim() : "";
    const version =
      typeof ref?.version === "string" ? ref.version.trim() : undefined;
    if (
      !ECOSYSTEM_PATTERN.test(ecosystem) ||
      name === "" ||
      name.length > MAX_PACKAGE_NAME_LENGTH ||
      !SAFE_TOKEN.test(name) ||
      (ref?.version !== undefined && typeof ref.version !== "string") ||
      (version !== undefined &&
        (version.length > MAX_VERSION_LENGTH ||
          (version !== "" && !SAFE_TOKEN.test(version))))
    ) {
      throw new MaintainerSignalError(
        "INVALID_REQUEST",
        `packages[${index}] must have a valid ecosystem, name, and optional version`,
      );
    }
    const normalized: PackageRef = { ecosystem, name };
    if (version) {
      normalized.version = version;
    }
    const key = packageKey(ecosystem, name);
    const existing = byKey.get(key);
    if (
      !existing ||
      compareOptional(normalized.version, existing.version) < 0
    ) {
      byKey.set(key, normalized);
    }
  });
  return [...byKey.values()].sort(comparePackages);
}

/**
 * Derive package references from an ingested SBOM. Components without a purl
 * carry no reliable ecosystem and are left out.
 */
export function packagesFromSbom(sbom: NormalizedSbom): PackageRef[] {
  const refs: PackageRef[] = [];
  for (const component of sbom.components) {
    const parsed = component.purl ? parsePurl(component.purl) : undefined;
    if (parsed) {
      refs.push(parsed);
    }
  }
  return normalizePackageRefs(refs);
}

/** Minimal purl parser: `pkg:type/namespace/name@version?qualifiers#subpath`. */
export function parsePurl(purl: string): PackageRef | undefined {
  const match = /^pkg:([A-Za-z][A-Za-z0-9.+-]*)\/([^?#]+)/.exec(purl.trim());
  if (!match) {
    return undefined;
  }
  const ecosystem = match[1].toLowerCase();
  let path = match[2];
  let version: string | undefined;
  const at = path.lastIndexOf("@");
  if (at > path.lastIndexOf("/")) {
    version = path.slice(at + 1);
    path = path.slice(0, at);
  }
  let segments: string[];
  try {
    segments = path
      .split("/")
      .filter((s) => s !== "")
      .map((s) => decodeURIComponent(s));
    version = version === undefined ? undefined : decodeURIComponent(version);
  } catch {
    return undefined;
  }
  if (segments.length === 0) {
    return undefined;
  }
  const ref: PackageRef = { ecosystem, name: segments.join("/") };
  if (version) {
    ref.version = version;
  }
  return ref;
}

export function normalizeHandle(handle: unknown): string | undefined {
  if (typeof handle !== "string") {
    return undefined;
  }
  const normalized = handle.normalize("NFC").trim().toLowerCase();
  return normalized !== "" &&
    normalized.length <= MAX_HANDLE_LENGTH &&
    SAFE_TOKEN.test(normalized)
    ? normalized
    : undefined;
}

/** SHA-256 of the lower-cased domain of `email`, or undefined if it has none. */
export function emailDomainDigest(email: unknown): string | undefined {
  if (typeof email !== "string") {
    return undefined;
  }
  const at = email.lastIndexOf("@");
  const domain =
    at >= 0
      ? email
          .slice(at + 1)
          .trim()
          .toLowerCase()
      : "";
  if (domain === "" || !/^[a-z0-9.-]+$/.test(domain)) {
    return undefined;
  }
  return crypto.createHash("sha256").update(domain, "utf8").digest("hex");
}

/**
 * Turn a provider response into a snapshot: handles normalized, entries with
 * unusable handles dropped, duplicates merged, emails reduced to domain digests.
 *
 * @throws InvalidMaintainerMetadataError when the response is not the expected
 *   shape or lists more than `maxMaintainers` entries.
 */
export function normalizeMaintainerSnapshot(
  raw: unknown,
  maxMaintainers: number,
): PackageMaintainerSnapshot {
  const value = raw as Partial<RawPackageMaintainers> | null;
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray(value.maintainers)
  ) {
    throw new InvalidMaintainerMetadataError("maintainers must be an array");
  }
  if (value.maintainers.length > maxMaintainers) {
    throw new InvalidMaintainerMetadataError("too many maintainers");
  }
  const byHandle = new Map<string, MaintainerIdentity>();
  for (const entry of value.maintainers) {
    const handle = normalizeHandle((entry as RawMaintainer | null)?.handle);
    if (!handle) {
      continue;
    }
    const digest = emailDomainDigest((entry as RawMaintainer).email);
    const existing = byHandle.get(handle);
    if (!existing) {
      byHandle.set(
        handle,
        digest ? { handle, emailDomainDigest: digest } : { handle },
      );
    } else if (
      digest &&
      (!existing.emailDomainDigest || digest < existing.emailDomainDigest)
    ) {
      // Keep the lowest digest so duplicate entries resolve deterministically.
      existing.emailDomainDigest = digest;
    }
  }
  const snapshot: PackageMaintainerSnapshot = {
    maintainers: [...byHandle.values()].sort((a, b) =>
      compareStrings(a.handle, b.handle),
    ),
  };
  const publisher = normalizeHandle(value.publisher);
  if (publisher) {
    snapshot.publisher = publisher;
  }
  return snapshot;
}

/**
 * Compare `current` with `baseline` for one package and return every signal,
 * unfiltered by severity. Returns `[]` when there is no baseline, because a
 * first observation carries no history to compare against.
 */
export function detectMaintainerChanges(
  ref: PackageRef,
  baseline: MaintainerBaseline | undefined,
  current: PackageMaintainerSnapshot,
  severities: Partial<
    Record<MaintainerSignalType, MaintainerSignalSeverity>
  > = DEFAULT_SIGNAL_SEVERITY,
): MaintainerSignal[] {
  if (!baseline) {
    return [];
  }
  const before = new Map(baseline.maintainers.map((m) => [m.handle, m]));
  const after = new Map(current.maintainers.map((m) => [m.handle, m]));
  const added = [...after.keys()]
    .filter((h) => !before.has(h))
    .sort(compareStrings);
  const removed = [...before.keys()]
    .filter((h) => !after.has(h))
    .sort(compareStrings);
  const domainChanged = [...after.values()]
    .filter((m) => {
      const previous = before.get(m.handle)?.emailDomainDigest;
      return (
        previous !== undefined &&
        m.emailDomainDigest !== undefined &&
        previous !== m.emailDomainDigest
      );
    })
    .map((m) => m.handle)
    .sort(compareStrings);

  const signals: MaintainerSignal[] = [];
  const emit = (type: MaintainerSignalType, handles: string[]) => {
    const signal: MaintainerSignal = {
      type,
      severity: severities[type] ?? DEFAULT_SIGNAL_SEVERITY[type],
      ecosystem: ref.ecosystem,
      package: ref.name,
      handles,
      baselineObservedAt: baseline.observedAt,
    };
    if (ref.version) {
      signal.version = ref.version;
    }
    signals.push(signal);
  };

  const fullTransfer =
    before.size > 0 && after.size > 0 && added.length === after.size;
  if (fullTransfer) {
    // Supersedes the separate added/removed signals for the same change.
    emit("OWNERSHIP_TRANSFERRED", added);
  } else {
    if (added.length > 0) {
      emit("MAINTAINER_ADDED", added);
    }
    if (removed.length > 0) {
      emit("MAINTAINER_REMOVED", removed);
    }
  }
  if (domainChanged.length > 0) {
    emit("MAINTAINER_EMAIL_DOMAIN_CHANGED", domainChanged);
  }
  if (ref.version && current.publisher && !before.has(current.publisher)) {
    emit("PUBLISHED_BY_NEW_MAINTAINER", [current.publisher]);
  }
  return signals;
}

/** True when the maintainer set or any domain digest differs. */
export function maintainersChanged(
  baseline: MaintainerBaseline | undefined,
  current: PackageMaintainerSnapshot,
): boolean {
  if (!baseline) {
    return false;
  }
  if (baseline.maintainers.length !== current.maintainers.length) {
    return true;
  }
  return baseline.maintainers.some((m, i) => {
    const other = current.maintainers[i];
    return (
      m.handle !== other.handle ||
      m.emailDomainDigest !== other.emailDomainDigest
    );
  });
}

/** Highest severity first, then ecosystem, package, type. */
export function compareSignals(
  a: MaintainerSignal,
  b: MaintainerSignal,
): number {
  return (
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
    compareStrings(a.ecosystem, b.ecosystem) ||
    compareStrings(a.package, b.package) ||
    compareStrings(a.type, b.type)
  );
}

export function comparePackages(
  a: { ecosystem: string; name?: string; package?: string },
  b: { ecosystem: string; name?: string; package?: string },
): number {
  return (
    compareStrings(a.ecosystem, b.ecosystem) ||
    compareStrings(a.name ?? a.package ?? "", b.name ?? b.package ?? "")
  );
}

/** Locale-independent ordering, so output never depends on the host. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareOptional(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return compareStrings(a, b);
}
