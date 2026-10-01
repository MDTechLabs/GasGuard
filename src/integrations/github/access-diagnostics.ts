/**
 * Private Repository Access Diagnostics
 * 
 * Provides comprehensive diagnostics for accessing private GitHub repositories,
 * including authentication verification, permission checks, and rate limit monitoring.
 * Implements #1048
 */

import { GitHubClient } from './github-client';
import { AccessDiagnosticResult, GitHubRepository } from './types';

export interface DiagnosticOptions {
  checkPermissions?: boolean;
  checkRateLimit?: boolean;
  checkScopes?: boolean;
  testRepositoryAccess?: boolean;
}

export class AccessDiagnostics {
  private client: GitHubClient;
  private repository?: GitHubRepository;

  constructor(client: GitHubClient, repository?: GitHubRepository) {
    this.client = client;
    this.repository = repository;
  }

  /**
   * Run comprehensive access diagnostics
   */
  async runDiagnostics(options: DiagnosticOptions = {}): Promise<AccessDiagnosticResult> {
    const result: AccessDiagnosticResult = {
      canAccess: false,
      isAuthenticated: false,
      hasRequiredScopes: [],
      missingScopes: [],
      permissions: {},
      rateLimit: {
        limit: 0,
        remaining: 0,
        reset: new Date(),
      },
      errors: [],
    };

    const opts: Required<DiagnosticOptions> = {
      checkPermissions: true,
      checkRateLimit: true,
      checkScopes: true,
      testRepositoryAccess: true,
      ...options,
    };

    try {
      // Check authentication
      await this.checkAuthentication(result);

      // Check scopes if authenticated
      if (result.isAuthenticated && opts.checkScopes) {
        await this.checkScopes(result);
      }

      // Check rate limit
      if (opts.checkRateLimit) {
        await this.checkRateLimit(result);
      }

      // Check permissions
      if (result.isAuthenticated && opts.checkPermissions) {
        await this.checkPermissions(result);
      }

      // Test repository access if repository is configured
      if (this.repository && result.isAuthenticated && opts.testRepositoryAccess) {
        await this.testRepositoryAccess(result);
      }

      // Determine overall access
      result.canAccess = result.isAuthenticated && result.errors.length === 0;
    } catch (error) {
      result.errors.push(`Diagnostic failed: ${error}`);
      result.canAccess = false;
    }

    return result;
  }

  /**
   * Check if authenticated with GitHub
   */
  private async checkAuthentication(result: AccessDiagnosticResult): Promise<void> {
    try {
      const response = await this.client['client'].get('/user');
      result.isAuthenticated = true;
      
      // Store user info for context
      const userData = response.data;
      result.permissions['user'] = userData.login;
    } catch (error) {
      result.isAuthenticated = false;
      result.errors.push(`Authentication check failed: ${error}`);
    }
  }

  /**
   * Check OAuth scopes
   */
  private async checkScopes(result: AccessDiagnosticResult): Promise<void> {
    try {
      const response = await this.client['client'].get('/user');
      const authHeader = response.headers['x-oauth-scopes'];
      
      if (authHeader) {
        result.hasRequiredScopes = authHeader.split(', ').filter(s => s);
      }

      // Define required scopes for common operations
      const requiredScopes = ['repo', 'read:org'];
      result.missingScopes = requiredScopes.filter(
        scope => !result.hasRequiredScopes.includes(scope)
      );

      if (result.missingScopes.length > 0) {
        result.errors.push(
          `Missing required scopes: ${result.missingScopes.join(', ')}`
        );
      }
    } catch (error) {
      result.errors.push(`Scope check failed: ${error}`);
    }
  }

  /**
   * Check rate limit status
   */
  private async checkRateLimit(result: AccessDiagnosticResult): Promise<void> {
    try {
      const rateLimit = await this.client.getRateLimit();
      result.rateLimit = rateLimit;

      if (rateLimit.remaining === 0) {
        result.errors.push(
          `Rate limit exceeded. Resets at ${rateLimit.reset.toISOString()}`
        );
      } else if (rateLimit.remaining < 100) {
        result.errors.push(
          `Rate limit running low: ${rateLimit.remaining} remaining`
        );
      }
    } catch (error) {
      result.errors.push(`Rate limit check failed: ${error}`);
    }
  }

  /**
   * Check repository permissions
   */
  private async checkPermissions(result: AccessDiagnosticResult): Promise<void> {
    try {
      // Check user's overall permissions
      const reposResponse = await this.client['client'].get('/user/repos', {
        params: { per_page: 1, visibility: 'all' },
      });

      const hasRepoAccess = reposResponse.data.length > 0;
      result.permissions['repo'] = hasRepoAccess ? 'read' : 'none';

      // Check org access if available
      try {
        const orgsResponse = await this.client['client'].get('/user/orgs');
        result.permissions['org'] = orgsResponse.data.length > 0 ? 'read' : 'none';
      } catch (error) {
        result.permissions['org'] = 'none';
      }

      // Check if can create repos
      try {
        await this.client['client'].head('/user/repos');
        result.permissions['create_repo'] = 'write';
      } catch (error) {
        result.permissions['create_repo'] = 'none';
      }
    } catch (error) {
      result.errors.push(`Permission check failed: ${error}`);
    }
  }

  /**
   * Test access to specific repository
   */
  private async testRepositoryAccess(result: AccessDiagnosticResult): Promise<void> {
    if (!this.repository) {
      return;
    }

    try {
      const repoInfo = await this.client.getRepository(
        this.repository.owner,
        this.repository.repo
      );

      result.permissions['repository'] = this.repository.isPrivate ? 'read' : 'read';

      // Test specific operations based on repository visibility
      if (this.repository.isPrivate) {
        // For private repos, test branch access
        try {
          await this.client.getContents(
            this.repository.owner,
            this.repository.repo,
            ''
          );
          result.permissions['repository_contents'] = 'read';
        } catch (error) {
          result.permissions['repository_contents'] = 'none';
          result.errors.push(`Cannot access repository contents: ${error}`);
        }

        // Test branch protection access (requires admin access)
        try {
          await this.client.getBranchProtection(
            this.repository.owner,
            this.repository.repo,
            this.repository.defaultBranch
          );
          result.permissions['branch_protection'] = 'read';
        } catch (error) {
          result.permissions['branch_protection'] = 'none';
          // This is expected for non-admin users, not necessarily an error
        }
      }
    } catch (error) {
      result.permissions['repository'] = 'none';
      result.errors.push(`Repository access test failed: ${error}`);
    }
  }

  /**
   * Get diagnostic summary as human-readable string
   */
  formatDiagnosticSummary(result: AccessDiagnosticResult): string {
    const lines: string[] = [];

    lines.push('=== GitHub Access Diagnostics ===');
    lines.push(`Authenticated: ${result.isAuthenticated ? '✓' : '✗'}`);
    lines.push(`Can Access: ${result.canAccess ? '✓' : '✗'}`);
    lines.push('');

    if (result.rateLimit.limit > 0) {
      lines.push('Rate Limit:');
      lines.push(`  Limit: ${result.rateLimit.limit}`);
      lines.push(`  Remaining: ${result.rateLimit.remaining}`);
      lines.push(`  Resets: ${result.rateLimit.reset.toISOString()}`);
      lines.push('');
    }

    if (result.hasRequiredScopes.length > 0) {
      lines.push('Scopes:');
      result.hasRequiredScopes.forEach(scope => lines.push(`  ✓ ${scope}`));
      if (result.missingScopes.length > 0) {
        result.missingScopes.forEach(scope => lines.push(`  ✗ ${scope}`));
      }
      lines.push('');
    }

    if (Object.keys(result.permissions).length > 0) {
      lines.push('Permissions:');
      Object.entries(result.permissions).forEach(([key, value]) => {
        lines.push(`  ${key}: ${value}`);
      });
      lines.push('');
    }

    if (result.errors.length > 0) {
      lines.push('Errors:');
      result.errors.forEach(error => lines.push(`  ✗ ${error}`));
    } else {
      lines.push('No errors detected.');
    }

    return lines.join('\n');
  }

  /**
   * Quick health check
   */
  async quickHealthCheck(): Promise<{ healthy: boolean; message: string }> {
    try {
      const result = await this.runDiagnostics({
        checkPermissions: false,
        checkScopes: false,
        testRepositoryAccess: false,
        checkRateLimit: true,
      });

      if (!result.isAuthenticated) {
        return {
          healthy: false,
          message: 'Not authenticated with GitHub',
        };
      }

      if (result.rateLimit.remaining === 0) {
        return {
          healthy: false,
          message: `Rate limit exceeded. Resets at ${result.rateLimit.reset.toISOString()}`,
        };
      }

      return {
        healthy: true,
        message: `Healthy. ${result.rateLimit.remaining} rate limit calls remaining.`,
      };
    } catch (error) {
      return {
        healthy: false,
        message: `Health check failed: ${error}`,
      };
    }
  }
}
