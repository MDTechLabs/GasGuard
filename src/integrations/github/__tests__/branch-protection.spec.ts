/**
 * Unit tests for Branch Protection Awareness
 */

import { BranchProtectionAwareness } from '../branch-protection';
import { GitHubClient } from '../github-client';
import { GitHubRepository } from '../types';

describe('BranchProtectionAwareness', () => {
  let protection: BranchProtectionAwareness;
  let mockClient: jest.Mocked<GitHubClient>;
  let repository: GitHubRepository;

  beforeEach(() => {
    repository = {
      owner: 'test-owner',
      repo: 'test-repo',
      isPrivate: true,
      defaultBranch: 'main',
    };

    mockClient = {
      getBranchProtection: jest.fn(),
      getRepository: jest.fn(),
      client: {
        get: jest.fn(),
      },
    } as any;

    protection = new BranchProtectionAwareness(mockClient, repository);
  });

  describe('getBranchProtection', () => {
    it('should return protection summary for protected branch', async () => {
      const mockProtection = {
        pattern: 'main',
        required_pull_request_reviews: {
          required_approving_review_count: 2,
          require_code_owner_reviews: true,
        },
        required_status_checks: {
          contexts: ['ci', 'tests'],
        },
        required_linear_history: true,
        allow_deletions: false,
        allow_force_pushes: false,
      };

      mockClient.getBranchProtection.mockResolvedValue(mockProtection);

      const result = await protection.getBranchProtection('main');
      
      expect(result.isProtected).toBe(true);
      expect(result.branch).toBe('main');
      expect(result.rules).toBeDefined();
      expect(result.rules?.requiresApprovingReviews).toBe(true);
      expect(result.rules?.requiredApprovingReviewCount).toBe(2);
    });

    it('should return unprotected branch when no protection', async () => {
      mockClient.getBranchProtection.mockResolvedValue(null);

      const result = await protection.getBranchProtection('main');
      
      expect(result.isProtected).toBe(false);
      expect(result.rules).toBeUndefined();
    });

    it('should handle API errors gracefully', async () => {
      mockClient.getBranchProtection.mockRejectedValue(new Error('API error'));

      // Suppress console.error for this test
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = await protection.getBranchProtection('main');
      
      expect(result.isProtected).toBe(false);
      expect(result.errors).toBeUndefined();

      consoleSpy.mockRestore();
    });
  });

  describe('getProtectionImpact', () => {
    it('should return impact for protected branch', async () => {
      const mockProtection = {
        required_pull_request_reviews: {
          required_approving_review_count: 2,
        },
        required_status_checks: {
          contexts: ['ci', 'tests'],
        },
        allow_deletions: false,
        allow_force_pushes: false,
      };

      mockClient.getBranchProtection.mockResolvedValue(mockProtection);

      const impact = await protection.getProtectionImpact('main');
      
      expect(impact.requiresReview).toBe(true);
      expect(impact.requiredReviewers).toBe(2);
      expect(impact.requiresStatusChecks).toBe(true);
      expect(impact.requiredChecks).toEqual(['ci', 'tests']);
      expect(impact.blocksForcePush).toBe(true);
      expect(impact.blocksDeletion).toBe(true);
    });

    it('should return no impact for unprotected branch', async () => {
      mockClient.getBranchProtection.mockResolvedValue(null);

      const impact = await protection.getProtectionImpact('main');
      
      expect(impact.requiresReview).toBe(false);
      expect(impact.requiredReviewers).toBe(0);
      expect(impact.requiresStatusChecks).toBe(false);
      expect(impact.requiredChecks).toEqual([]);
    });
  });

  describe('canMergeBranch', () => {
    it('should allow merge when requirements met', async () => {
      const mockProtection = {
        required_pull_request_reviews: {
          required_approving_review_count: 2,
        },
        required_status_checks: {
          contexts: ['ci', 'tests'],
        },
      };

      mockClient.getBranchProtection.mockResolvedValue(mockProtection);

      const result = await protection.canMergeBranch('main', {
        hasRequiredApprovals: true,
        statusChecksPassed: ['ci', 'tests'],
      });
      
      expect(result.canMerge).toBe(true);
      expect(result.blockers).toHaveLength(0);
    });

    it('should block merge when approvals missing', async () => {
      const mockProtection = {
        required_pull_request_reviews: {
          required_approving_review_count: 2,
        },
      };

      mockClient.getBranchProtection.mockResolvedValue(mockProtection);

      const result = await protection.canMergeBranch('main', {
        hasRequiredApprovals: false,
        statusChecksPassed: [],
      });
      
      expect(result.canMerge).toBe(false);
      expect(result.blockers.some(b => b.includes('reviewer'))).toBe(true);
    });

    it('should block merge when status checks missing', async () => {
      const mockProtection = {
        required_status_checks: {
          contexts: ['ci', 'tests'],
        },
      };

      mockClient.getBranchProtection.mockResolvedValue(mockProtection);

      const result = await protection.canMergeBranch('main', {
        hasRequiredApprovals: true,
        statusChecksPassed: ['ci'],
      });
      
      expect(result.canMerge).toBe(false);
      expect(result.blockers.some(b => b.includes('status checks'))).toBe(true);
    });
  });

  describe('formatProtectionSummary', () => {
    it('should format protected branch summary', () => {
      const summary = {
        branch: 'main',
        isProtected: true,
        rules: {
          pattern: 'main',
          requiresApprovingReviews: true,
          requiredApprovingReviewCount: 2,
          requiresStatusChecks: true,
          requiredStatusCheckContexts: ['ci', 'tests'],
          requiresCodeOwnerReviews: true,
          requiresLinearHistory: true,
          allowsDeletions: false,
          allowsForcePushes: false,
          restrictsPushes: false,
          restrictsReviewDismissals: false,
        },
        restrictions: ['team:admins'],
        canBypass: false,
      };

      const formatted = protection.formatProtectionSummary(summary);
      
      expect(formatted).toContain('Protected: ✓');
      expect(formatted).toContain('Requires Reviews: ✓');
      expect(formatted).toContain('Required Reviewers: 2');
      expect(formatted).toContain('Requires Status Checks: ✓');
    });

    it('should format unprotected branch summary', () => {
      const summary = {
        branch: 'develop',
        isProtected: false,
        restrictions: [],
        canBypass: false,
      };

      const formatted = protection.formatProtectionSummary(summary);
      
      expect(formatted).toContain('Protected: ✗');
    });
  });
});
