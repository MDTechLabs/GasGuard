/**
 * Vendored dependency boundaries (#1168).
 *
 * Third-party code checked into a repository (vendored crates, bundled
 * dependencies, a committed `node_modules`) is not first-party source. Findings
 * raised inside those trees are noise, and path-based rules must not cross a
 * boundary: a file under `vendor/` belongs to its vendor root, not to the
 * repository.
 *
 * Boundaries are detected purely from paths, so the result is stable no matter
 * which files are present in a given scan.
 */

export const VENDOR_DIRECTORY_NAMES = [
  "node_modules",
  "vendor",
  "vendors",
  "third_party",
  "third-party",
  "deps",
  "extern",
  "external",
  ".yarn",
  "target",
];

export interface VendoredBoundary {
  /** Directory that starts the vendored tree, repository-relative. */
  directory: string;
  /** Depth of the boundary from the repository root, 0-based. */
  depth: number;
  /** Name of the matching directory segment. */
  marker: string;
}

export function isVendoredPath(
  filePath: string,
  extraDirectories: readonly string[] = [],
): boolean {
  const segments = normalize(filePath).split("/");
  const markers = new Set(
    [...VENDOR_DIRECTORY_NAMES, ...extraDirectories].map((entry) => entry.toLowerCase()),
  );
  return segments.some((segment) => markers.has(segment.toLowerCase()));
}

/** Every vendored boundary present in `paths`, shallowest first. */
export function findVendoredBoundaries(
  paths: readonly string[],
  extraDirectories: readonly string[] = [],
): VendoredBoundary[] {
  const markers = new Set(
    [...VENDOR_DIRECTORY_NAMES, ...extraDirectories].map((entry) => entry.toLowerCase()),
  );
  const found = new Map<string, VendoredBoundary>();

  for (const path of paths) {
    const segments = normalize(path).split("/");

    segments.forEach((segment, index) => {
      if (!markers.has(segment.toLowerCase())) {
        return;
      }
      const directory = segments.slice(0, index + 1).join("/");
      if (!found.has(directory)) {
        found.set(directory, { directory, depth: index, marker: segment });
      }
    });
  }

  return [...found.values()].sort(
    (left, right) =>
      left.depth - right.depth || (left.directory < right.directory ? -1 : 1),
  );
}

/** Split paths into first-party and vendored, preserving input order. */
export function splitByVendoredBoundary(
  paths: readonly string[],
  extraDirectories: readonly string[] = [],
): { firstParty: string[]; vendored: string[] } {
  const firstParty: string[] = [];
  const vendored: string[] = [];

  for (const path of paths) {
    if (isVendoredPath(path, extraDirectories)) {
      vendored.push(path);
    } else {
      firstParty.push(path);
    }
  }

  return { firstParty, vendored };
}

/**
 * The vendored root that owns `filePath`, or undefined for first-party code.
 */
export function vendoredRootFor(
  filePath: string,
  extraDirectories: readonly string[] = [],
): string | undefined {
  const normalized = normalize(filePath);
  const boundary = findVendoredBoundaries([normalized], extraDirectories).find((candidate) =>
    normalized.startsWith(`${candidate.directory}/`),
  );
  return boundary?.directory;
}

function normalize(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}
