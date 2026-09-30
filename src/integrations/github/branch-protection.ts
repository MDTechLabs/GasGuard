/**
 * Branch Protection Awareness
 * 
 * Provides awareness of GitHub branch protection rules to help understand
 * repository governance and security policies. This information can be used
 * to adjust analysis workflows based on branch protection requirements.
 * Implements #1044
 */

import { GitHubClient } from './github-client';
import { BranchProtectionRule, GitHubRepository } from './types';

export interface BranchProtectionSummary {
  branch: string;
  isProtected: boolean;
  rules?: BranchProtectionRule;
  restrictions: string[];
  canBypass: boolean;
}

export interface ProtectionImpact {
  requiresReview: boolean;
  requiredReviewers: number;
  requiresStatusChecks: boolean;
  requiredChecks: string[];
  blocksMergeWithoutApproval: boolean;
  blocksForcePush: boolean;
  blocksDeletion: boolean;
}

export class BranchProtectionAwareness {
  private client: GitHubClient;
  private repository: GitHubRepository;

  constructor(client: GitHubClient, repository: GitHubRepository) {
    this.client = client;
    this.repository = repository;
  }

  /**
   * Get branch protection rules for a specific branch
   */
  async getBranchProtection(branch: string): Promise<BranchProtectionSummary> {
    try {
      const protection = await this.client.getBranchProtection(
        this.repository.owner,
        this.repository.repo,
        branch
      );

      if (!protection) {
        return {
          branch,
          isProtected: false,
          restrictions: [],
          canBypass: false,
        };
      }

      const rules = this.parseProtectionRules(protection);
      const restrictions = this.extractRestrictions(protection);

      return {
        branch,
        isProtected: true,
        rules,
        restrictions,
        canBypass: this.canBypassProtection(protection),
      };
    } catch (error) {
      console.error(`Failed to get branch protection for ${branch}:`, error);
      return {
        branch,
        isProtected: false,
        restrictions: [],
        canBypass: false,
      };
    }
  }

  /**
   * Get protection for all branches
   */
  async getAllBranchProtections(): Promise<BranchProtectionSummary[]> {
    const protections: BranchProtectionSummary[] = [];

    try {
      // Get all branches
      const branches = await this.client['client'].get(
        `/repos/${this.repository.owner}/${this.repository.repo}/branches`
      );

      const branchNames = branches.data.map((b: any) => b.name);

      // Check protection for each branch (in parallel)
      const protectionPromises = branchNames.map(branch =>
        this.getBranchProtection(branch)
      );

      const results = await Promise.all(protectionPromises);
      protections.push(...results);
    } catch (error) {
      console.error('Failed to get all branch protections:', error);
    }

    return protections;
  }

  /**
   * Get protection impact for a branch
   */
  async getProtectionImpact(branch: string): Promise<ProtectionImpact> {
    const summary = await this.getBranchProtection(branch);

    if (!summary.isProtected || !summary.rules) {
      return {
        requiresReview: false,
        requiredReviewers: 0,
        requiresStatusChecks: false,
        requiredChecks: [],
        blocksMergeWithoutApproval: false,
        blocksForcePush: false,
        blocksDeletion: false,
      };
    }

    return {
      requiresReview: summary.rules.requiresApprovingReviews,
      requiredReviewers: summary.rules.requiredApprovingReviewCount,
      requiresStatusChecks: summary.rules.requiresStatusChecks,
      requiredChecks: summary.rules.requiredStatusCheckContexts,
      blocksMergeWithoutApproval: summary.rules.requiresApprovingReviews,
      blocksForcePush: !summary.rules.allowsForcePushes,
      blocksDeletion: !summary.rules.allowsDeletions,
    };
  }

  /**
   * Check if a branch can be merged given current state
   */
  async canMergeBranch(
    branch: string,
    context: {
      hasRequiredApprovals: boolean;
      statusChecksPassed: string[];
    }
  ): Promise<{ canMerge: boolean; blockers: string[] }> {
    const impact = await this.getProtectionImpact(branch);
    const blockers: string[] = [];

    if (impact.requiresReview && !context.hasRequiredApprovals) {
      blockers.push(
        `Branch requires ${impact.requiredReviewers} reviewer approval(s)`
      );
    }

    if (impact.requiresStatusChecks) {
      const missingChecks = impact.requiredChecks.filter(
        check => !context.statusChecksPassed.includes(check)
      );

      if (missingChecks.length > 0) {
        blockers.push(
          `Missing required status checks: ${missingChecks.join(', ')}`
        );
      }
    }

    return {
      canMerge: blockers.length === 0,
      blockers,
    };
  }

  /**
   * Parse protection rules from GitHub API response
   */
  private parseProtectionRules(protection: any): BranchProtectionRule {
    return {
      pattern: protection.pattern || '*',
      requiresApprovingReviews: !!protection.required_pull_request_reviews,
      requiredApprovingReviewCount:
        protection.required_pull_request_reviews?.required_approving_review_count || 0,
      requiresStatusChecks: !!protection.required_status_checks,
      requiredStatusCheckContexts:
        protection.required_status_checks?.contexts || [],
      requiresCodeOwnerReviews:
        protection.required_pull_request_reviews?.require_code_owner_reviews || false,
      requiresLinearHistory: !!protection.required_linear_history,
      allowsDeletions: !!protection.allow_deletions,
      allowsForcePushes: !!protection.allow_force_pushes,
      restrictsPushes: !!protection.restrictions,
      restrictsReviewDismissals:
        !!protection.required_pull_request_reviews?.restrictions,
    };
  }

  /**
   * Extract restrictions from protection rules
   */
  private extractRestrictions(protection: any): string[] {
    const restrictions: string[] = [];

    if (protection.restrictions) {
      if (protection.restrictions.apps) {
        restrictions.push(
          ...protection.restrictions.apps.map((app: any) => `app:${app.slug}`)
        );
      }
      if (protection.restrictions.users) {
        restrictions.push(
          ...protection.restrictions.users.map((user: any) => `user:${user.login}`)
        );
      }
      if (protection.restrictions.teams) {
        restrictions.push(
          ...protection.restrictions.teams.map((team: any) => `team:${team.slug}`)
        );
      }
    }

    if (protection.required_pull_request_reviews?.restrictions) {
      const reviewRestrictions = protection.required_pull_request_reviews.restrictions;
      if (reviewRestrictions.apps) {
        restrictions.push(
          ...reviewRestrictions.apps.map((app: any) => `review:app:${app.slug}`)
        );
      }
      if (reviewRestrictions.users) {
        restrictions.push(
          ...reviewRestrictions.users.map((user: any) => `review:user:${user.login}`)
        );
      }
      if (reviewRestrictions.teams) {
        restrictions.push(
          ...reviewRestrictions.teams.map((team: any) => `review:team:${team.slug}`)
        );
      }
    }

    return restrictions;
  }

  /**
   * Check if current user can bypass protection
   */
  private canBypassProtection(protection: any): boolean {
    // This is a simplified check - in production, you'd need to check
    // the current user's permissions against the restrictions
    return (
      protection.allow_deletions ||
      protection.allow_force_pushes ||
      !protection.restrictions
    );
  }

  /**
   * Get protected branches only
   */
  async getProtectedBranches(): Promise<BranchProtectionSummary[]> {
    const allProtections = await this.getAllBranchProtections();
    return allProtections.filter(p => p.isProtected);
  }

  /**
   * Get default branch protection
   */
  async getDefaultBranchProtection(): Promise<BranchProtectionSummary> {
    return this.getBranchProtection(this.repository.defaultBranch);
  }

  /**
   * Compare protection between two branches
   */
  async compareBranchProtection(
    branch1: string,
    branch2: string
  ): Promise<{ branch1: BranchProtectionSummary; branch2: BranchProtectionSummary; differences: string[] }> {
    const [p1, p2] = await Promise.all([
      this.getBranchProtection(branch1),
      this.getBranchProtection(branch2),
    ]);

    const differences: string[] = [];

    if (p1.isProtected !== p2.isProtected) {
      differences.push(
        `Protection status differs: ${branch1}=${p1.isProtected}, ${branch2}=${p2.isProtected}`
      );
    }

    if (p1.rules && p2.rules) {
      if (p1.rules.requiresApprovingReviews !== p2.rules.requiresApprovingReviews) {
        differences.push('Review requirement differs');
      }
      if (p1.rules.requiredApprovingReviewCount !== p2.rules.requiredApprovingReviewCount) {
        differences.push('Required reviewer count differs');
      }
      if (p1.rules.requiresStatusChecks !== p2.rules.requiresStatusChecks) {
        differences.push('Status check requirement differs');
      }
    }

    return {
      branch1: p1,
      branch2: p2,
      differences,
    };
  }

  /**
   * Format protection summary as human-readable string
   */
  formatProtectionSummary(summary: BranchProtectionSummary): string {
    const lines: string[] = [];

    lines.push(`=== Branch Protection: ${summary.branch} ===`);
    lines.push(`Protected: ${summary.isProtected ? '✓' : '✗'}`);

    if (summary.isProtected && summary.rules) {
      lines.push('');
      lines.push('Rules:');
      lines.push(`  Pattern: ${summary.rules.pattern}`);
      lines.push(`  Requires Reviews: ${summary.rules.requiresApprovingReviews ? '✓' : '✗'}`);
      if (summary.rules.requiresApprovingReviews) {
        lines.push(`  Required Reviewers: ${summary.rules.requiredApprovingReviewCount}`);
        lines.push(`  Code Owner Reviews: ${summary.rules.requiresCodeOwnerReviews ? '✓' : '✗'}`);
      }
      lines.push(`  Requires Status Checks: ${summary.rules.requiresStatusChecks ? '✓' : '✗'}`);
      if (summary.rules.requiresStatusChecks && summary.rules.requiredStatusCheckContexts.length > 0) {
        lines.push(`  Required Checks: ${summary.rules.requiredStatusCheckContexts.join(', ')}`);
      }
      lines.push(`  Linear History: ${summary.rules.requiresLinearHistory ? '✓' : '✗'}`);
      lines.push(`  Allows Deletions: ${summary.rules.allowsDeletions ? '✓' : '✗'}`);
      lines.push(`  Allows Force Push: ${summary.rules.allowsForcePushes ? '✓' : '✗'}`);
    }

    if (summary.restrictions.length > 0) {
      lines.push('');
      lines.push('Restrictions:');
      summary.restrictions.forEach(r => lines.push(`  - ${r}`));
    }

    return lines.join('\n');
  }
}
