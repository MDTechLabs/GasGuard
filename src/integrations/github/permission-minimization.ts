/**
 * GitHub App Permission Minimization Checks (#1244)
 *
 * InstallationValidator (#1041) checks that an installation has *at least*
 * the permissions GasGuard requires. This checker looks the other
 * direction: it flags an installation that has *more* access than
 * GasGuard's integration actually uses — the over-privileged case that
 * InstallationValidator cannot see, since "has enough" and "has too much"
 * are independent conditions an installation can satisfy at the same time.
 *
 * Checks performed against GASGUARD_BASELINE_PERMISSIONS:
 *   - a granted permission above the level GasGuard's client code
 *     actually calls (e.g. `contents: write` when every call GasGuard
 *     makes only reads content)
 *   - a granted permission GasGuard does not use at all
 *   - `repository_selection: 'all'` (every repo in the account/org) instead
 *     of an explicit, selected subset
 */

import { GitHubClient } from './github-client';
import {
  ExcessPermission,
  PermissionMinimizationOptions,
  PermissionMinimizationResult,
} from './types';

const PERMISSION_HIERARCHY: Record<string, number> = {
  none: 0,
  read: 1,
  write: 2,
  admin: 3,
};

/**
 * The permissions GasGuard's GitHub client (github-client.ts) actually
 * exercises, and the minimum level each is used at. Keep this in sync with
 * github-client.ts: a permission this client never calls for should not
 * appear here, and a permission it needs must be listed at its true
 * minimum level (not rounded up "to be safe" — that defeats the point of a
 * minimization check).
 */
export const GASGUARD_BASELINE_PERMISSIONS: Record<string, string> = {
  // Base repository metadata — required for any GitHub App installation.
  metadata: 'read',
  // getContents / getTree / getLanguages — source reading for analysis.
  contents: 'read',
  // getPullRequestFiles — PR changed-file discovery (#1043).
  pull_requests: 'read',
  // getBranchProtection — branch protection awareness (#1044).
  administration: 'read',
};

export class PermissionMinimizationChecker {
  constructor(private readonly client: GitHubClient) {}

  /**
   * Check the installation on a specific repository.
   */
  async checkRepositoryInstallation(
    owner: string,
    repo: string,
    options: PermissionMinimizationOptions = {},
  ): Promise<PermissionMinimizationResult> {
    const data = await this.client.getRepositoryInstallation(owner, repo);
    return this.evaluate(data, options);
  }

  /**
   * Check an installation directly by its installation ID.
   */
  async checkAppInstallation(
    installationId: number | string,
    options: PermissionMinimizationOptions = {},
  ): Promise<PermissionMinimizationResult> {
    const data = await this.client.getAppInstallation(installationId);
    return this.evaluate(data, options);
  }

  /**
   * Pure evaluation over an already-fetched installation payload —
   * exposed so callers (and tests) can check minimization without an
   * extra API round trip when they already have the installation data
   * (e.g. from InstallationValidator's own fetch).
   */
  evaluate(
    data: { id?: number; permissions?: Record<string, string>; repository_selection?: 'all' | 'selected' },
    options: PermissionMinimizationOptions = {},
  ): PermissionMinimizationResult {
    const baseline = options.baselinePermissions ?? GASGUARD_BASELINE_PERMISSIONS;
    const granted: Record<string, string> = data.permissions ?? {};

    const excessPermissions: ExcessPermission[] = [];
    const unusedPermissions: string[] = [];

    for (const [permission, grantedLevel] of Object.entries(granted)) {
      if (grantedLevel === 'none') continue;

      const requiredLevel = baseline[permission];
      if (requiredLevel === undefined) {
        unusedPermissions.push(permission);
        continue;
      }

      const grantedRank = PERMISSION_HIERARCHY[grantedLevel] ?? 0;
      const requiredRank = PERMISSION_HIERARCHY[requiredLevel] ?? 0;
      if (grantedRank > requiredRank) {
        excessPermissions.push({ permission, grantedLevel, requiredLevel });
      }
    }

    const repositorySelection = data.repository_selection ?? 'selected';
    const broadRepositorySelection = repositorySelection === 'all';

    const isMinimized =
      excessPermissions.length === 0 &&
      unusedPermissions.length === 0 &&
      !broadRepositorySelection;

    const recommendations = this.buildRecommendations(
      excessPermissions,
      unusedPermissions,
      broadRepositorySelection,
    );

    return {
      installationId: data.id,
      isMinimized,
      excessPermissions,
      unusedPermissions,
      broadRepositorySelection,
      repositorySelection,
      grantedPermissions: granted,
      baselinePermissions: baseline,
      recommendations,
    };
  }

  private buildRecommendations(
    excessPermissions: ExcessPermission[],
    unusedPermissions: string[],
    broadRepositorySelection: boolean,
  ): string[] {
    const recommendations: string[] = [];

    for (const excess of excessPermissions) {
      recommendations.push(
        `Reduce '${excess.permission}' from '${excess.grantedLevel}' to '${excess.requiredLevel}' — ` +
          `GasGuard does not use the elevated access.`,
      );
    }

    for (const unused of unusedPermissions) {
      recommendations.push(
        `Remove permission '${unused}' — GasGuard's integration does not use it at all.`,
      );
    }

    if (broadRepositorySelection) {
      recommendations.push(
        `Change repository selection from 'all' to 'selected' and explicitly list the ` +
          `repositories GasGuard needs, instead of granting access to every repository in the account/org.`,
      );
    }

    return recommendations;
  }
}
