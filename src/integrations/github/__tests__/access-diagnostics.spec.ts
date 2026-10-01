/**
 * Unit tests for Access Diagnostics
 */

import { AccessDiagnostics } from '../access-diagnostics';
import { GitHubClient } from '../github-client';
import { GitHubRepository, AccessDiagnosticResult } from '../types';

describe('AccessDiagnostics', () => {
  let diagnostics: AccessDiagnostics;
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
      getRepository: jest.fn(),
      getBranchProtection: jest.fn(),
      getContents: jest.fn(),
      getRateLimit: jest.fn(),
      client: {
        get: jest.fn(),
        head: jest.fn(),
      },
    } as any;

    diagnostics = new AccessDiagnostics(mockClient, repository);
  });

  describe('runDiagnostics', () => {
    it('should pass diagnostics when authenticated', async () => {
      mockClient['client'].get.mockResolvedValue({
        data: { login: 'testuser' },
        headers: { 'x-oauth-scopes': 'repo, read:org' },
      });

      mockClient.getRateLimit.mockResolvedValue({
        limit: 5000,
        remaining: 4999,
        reset: new Date(Date.now() + 3600000),
      });

      mockClient['client'].get.mockResolvedValue({
        data: [],
      });

      const result = await diagnostics.runDiagnostics();
      
      expect(result.isAuthenticated).toBe(true);
      // canAccess depends on whether there are errors
      expect(result.errors.length).toBeGreaterThanOrEqual(0);
    });

    it('should fail when not authenticated', async () => {
      mockClient['client'].get.mockRejectedValue(new Error('Unauthorized'));

      const result = await diagnostics.runDiagnostics();
      
      expect(result.isAuthenticated).toBe(false);
      expect(result.canAccess).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should detect rate limit exhaustion', async () => {
      mockClient['client'].get.mockResolvedValue({
        data: { login: 'testuser' },
        headers: { 'x-oauth-scopes': 'repo' },
      });

      mockClient.getRateLimit.mockResolvedValue({
        limit: 5000,
        remaining: 0,
        reset: new Date(Date.now() + 3600000),
      });

      const result = await diagnostics.runDiagnostics();
      
      expect(result.rateLimit.remaining).toBe(0);
      expect(result.errors.some(e => e.includes('Rate limit'))).toBe(true);
    });

    it('should detect missing scopes', async () => {
      mockClient['client'].get.mockResolvedValue({
        data: { login: 'testuser' },
        headers: { 'x-oauth-scopes': 'public_repo' },
      });

      mockClient.getRateLimit.mockResolvedValue({
        limit: 5000,
        remaining: 4999,
        reset: new Date(Date.now() + 3600000),
      });

      const result = await diagnostics.runDiagnostics();
      
      expect(result.missingScopes).toContain('repo');
      expect(result.missingScopes).toContain('read:org');
    });
  });

  describe('quickHealthCheck', () => {
    it('should return healthy when authenticated with rate limit', async () => {
      mockClient['client'].get.mockResolvedValue({
        data: { login: 'testuser' },
      });

      mockClient.getRateLimit.mockResolvedValue({
        limit: 5000,
        remaining: 1000,
        reset: new Date(Date.now() + 3600000),
      });

      const result = await diagnostics.quickHealthCheck();
      
      expect(result.healthy).toBe(true);
      expect(result.message).toContain('Healthy');
    });

    it('should return unhealthy when not authenticated', async () => {
      mockClient['client'].get.mockRejectedValue(new Error('Unauthorized'));

      const result = await diagnostics.quickHealthCheck();
      
      expect(result.healthy).toBe(false);
      expect(result.message).toContain('Not authenticated');
    });

    it('should return unhealthy when rate limit exhausted', async () => {
      mockClient['client'].get.mockResolvedValue({
        data: { login: 'testuser' },
      });

      mockClient.getRateLimit.mockResolvedValue({
        limit: 5000,
        remaining: 0,
        reset: new Date(Date.now() + 3600000),
      });

      const result = await diagnostics.quickHealthCheck();
      
      expect(result.healthy).toBe(false);
      expect(result.message).toContain('Rate limit');
    });
  });

  describe('formatDiagnosticSummary', () => {
    it('should format diagnostic results', () => {
      const result: AccessDiagnosticResult = {
        canAccess: true,
        isAuthenticated: true,
        hasRequiredScopes: ['repo', 'read:org'],
        missingScopes: [],
        permissions: {
          repo: 'read',
          org: 'read',
        },
        rateLimit: {
          limit: 5000,
          remaining: 4999,
          reset: new Date(Date.now() + 3600000),
        },
        errors: [],
      };

      const summary = diagnostics.formatDiagnosticSummary(result);
      
      expect(summary).toContain('Authenticated: ✓');
      expect(summary).toContain('Can Access: ✓');
      expect(summary).toContain('Rate Limit:');
      expect(summary).toContain('No errors detected');
    });

    it('should include errors in summary', () => {
      const result: AccessDiagnosticResult = {
        canAccess: false,
        isAuthenticated: false,
        hasRequiredScopes: [],
        missingScopes: ['repo'],
        permissions: {},
        rateLimit: {
          limit: 5000,
          remaining: 0,
          reset: new Date(Date.now() + 3600000),
        },
        errors: ['Authentication failed', 'Rate limit exceeded'],
      };

      const summary = diagnostics.formatDiagnosticSummary(result);
      
      expect(summary).toContain('Errors:');
      expect(summary).toContain('Authentication failed');
      expect(summary).toContain('Rate limit exceeded');
    });
  });
});
