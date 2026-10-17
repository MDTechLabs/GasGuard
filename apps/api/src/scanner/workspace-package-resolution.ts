/**
 * Workspace-aware package resolution (#1169).
 *
 * In a monorepo the same package name can appear in several workspaces, and a
 * bare import resolves against the nearest workspace that declares it. This
 * module expands the workspace patterns from the root manifest into concrete
 * directories and resolves a package name to the workspace that owns it, so
 * findings can be attributed to the right package instead of the repository
 * root.
 *
 * No filesystem access: callers pass the directories and manifests they found.
 */

export interface WorkspacePackage {
  /** Package name from the workspace manifest, when it declares one. */
  name?: string;
  /** Repository-relative workspace directory. */
  directory: string;
}

export interface WorkspaceResolution {
  packageName: string;
  directory?: string;
  /** True when more than one workspace declares the same name. */
  ambiguous: boolean;
}

/** Convert a workspace glob (`packages/*`, `apps/**`) into a matcher. */
export function workspacePatternToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, "/").replace(/\/+$/, "");
  const escaped = normalized
    .split("/")
    .map((segment) => {
      if (segment === "**") {
        return ".*";
      }
      if (segment === "*") {
        return "[^/]+";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");

  return new RegExp(`^${escaped}$`);
}

/** Directories from `candidates` matched by any workspace pattern. */
export function expandWorkspacePatterns(
  patterns: readonly string[],
  candidates: readonly string[],
): string[] {
  const matchers = patterns.map(workspacePatternToRegExp);
  return [...candidates]
    .filter((candidate) => {
      const normalized = candidate.replace(/\\/g, "/").replace(/\/+$/, "");
      return matchers.some((matcher) => matcher.test(normalized));
    })
    .sort();
}

/**
 * Resolve a package name to the workspace directory that owns it.
 *
 * Package names are compared case-insensitively, matching npm's rules. When two
 * workspaces declare the same name the result is flagged `ambiguous` and no
 * directory is chosen, so the caller can fall back to the repository root.
 */
export function resolvePackageWorkspace(
  packageName: string,
  workspaces: readonly WorkspacePackage[],
): WorkspaceResolution {
  if (typeof packageName !== "string" || packageName.trim() === "") {
    throw new TypeError("packageName must be a non-empty string");
  }

  const target = packageName.trim().toLowerCase();
  const matches = workspaces.filter(
    (workspace) => workspace.name?.trim().toLowerCase() === target,
  );

  if (matches.length === 0) {
    return { packageName, ambiguous: false };
  }

  if (matches.length > 1) {
    return { packageName, ambiguous: true };
  }

  return { packageName, directory: matches[0].directory, ambiguous: false };
}

/**
 * Resolve the workspace that contains a file, by longest directory prefix.
 */
export function workspaceForFile(
  filePath: string,
  workspaces: readonly WorkspacePackage[],
): WorkspacePackage | undefined {
  const normalized = filePath.replace(/\\/g, "/");
  const candidates = workspaces
    .filter((workspace) => {
      const directory = workspace.directory.replace(/\\/g, "/").replace(/\/+$/, "");
      return normalized === directory || normalized.startsWith(`${directory}/`);
    })
    .sort((left, right) => right.directory.length - left.directory.length);

  return candidates[0];
}
