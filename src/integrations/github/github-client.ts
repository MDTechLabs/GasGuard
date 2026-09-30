/**
 * GitHub Client
 * 
 * Provides a unified interface for interacting with GitHub API
 * with support for authentication, rate limiting, and error handling.
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { GitHubAuthConfig, GitHubRepository, AccessDiagnosticResult } from './types';

export class GitHubClient {
  private client: AxiosInstance;
  private auth: GitHubAuthConfig;

  constructor(auth: GitHubAuthConfig = {}) {
    this.auth = auth;
    this.client = axios.create({
      baseURL: 'https://api.github.com',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        ...(auth.token && { 'Authorization': `Bearer ${auth.token}` }),
        ...(auth.appId && { 'Authorization': `Bearer ${this.generateJwt(auth)}` }),
      },
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error) => this.handleError(error)
    );
  }

  /**
   * Generate JWT for app authentication
   */
  private generateJwt(auth: GitHubAuthConfig): string {
    // Simplified JWT generation - in production, use proper JWT library
    // This is a placeholder for the actual implementation
    if (!auth.privateKey || !auth.appId) {
      throw new Error('Missing required app authentication credentials');
    }
    // TODO: Implement proper JWT generation using jsonwebtoken or similar
    return 'generated-jwt-token';
  }

  /**
   * Handle API errors with rate limit awareness
   */
  private handleError(error: AxiosError): never {
    if (error.response) {
      const rateLimitRemaining = error.response.headers['x-ratelimit-remaining'];
      const rateLimitReset = error.response.headers['x-ratelimit-reset'];

      if (error.response.status === 403 && rateLimitRemaining === '0') {
        throw new Error(
          `GitHub API rate limit exceeded. Resets at ${new Date(
            Number(rateLimitReset) * 1000
          ).toISOString()}`
        );
      }

      if (error.response.status === 401) {
        throw new Error('GitHub authentication failed. Check your token.');
      }

      if (error.response.status === 404) {
        throw new Error('GitHub resource not found.');
      }
    }

    throw error;
  }

  /**
   * Get repository information
   */
  async getRepository(owner: string, repo: string): Promise<GitHubRepository> {
    const response = await this.client.get(`/repos/${owner}/${repo}`);
    const data = response.data;

    return {
      owner,
      repo,
      isPrivate: data.private,
      defaultBranch: data.default_branch,
    };
  }

  /**
   * Get branch protection rules
   */
  async getBranchProtection(
    owner: string,
    repo: string,
    branch: string
  ): Promise<any> {
    try {
      const response = await this.client.get(
        `/repos/${owner}/${repo}/branches/${branch}/protection`
      );
      return response.data;
    } catch (error) {
      // Branch protection might not be enabled
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get repository languages
   */
  async getLanguages(owner: string, repo: string): Promise<Record<string, number>> {
    const response = await this.client.get(`/repos/${owner}/${repo}/languages`);
    return response.data;
  }

  /**
   * Get repository contents
   */
  async getContents(
    owner: string,
    repo: string,
    path: string,
    ref?: string
  ): Promise<any> {
    const params = ref ? { ref } : {};
    const response = await this.client.get(
      `/repos/${owner}/${repo}/contents/${path}`,
      { params }
    );
    return response.data;
  }

  /**
   * Get tree (directory structure)
   */
  async getTree(owner: string, repo: string, sha: string, recursive = false): Promise<any> {
    const response = await this.client.get(`/repos/${owner}/${repo}/git/trees/${sha}`, {
      params: { recursive: recursive ? 1 : 0 },
    });
    return response.data;
  }

  /**
   * Run access diagnostics
   */
  async runAccessDiagnostics(): Promise<AccessDiagnosticResult> {
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

    try {
      // Check authentication by fetching user info
      const userResponse = await this.client.get('/user');
      result.isAuthenticated = true;
      result.canAccess = true;

      // Get rate limit info
      const rateLimitResponse = await this.client.get('/rate_limit');
      const rateData = rateLimitResponse.data.resources.core;
      result.rateLimit = {
        limit: rateData.limit,
        remaining: rateData.remaining,
        reset: new Date(rateData.reset * 1000),
      };

      // Check scopes from token
      const authHeader = userResponse.headers['x-oauth-scopes'];
      result.hasRequiredScopes = authHeader ? authHeader.split(', ') : [];

      // Check repository permissions if repository is configured
      if (this.auth.token) {
        try {
          const repoResponse = await this.client.get('/user/repos', {
            params: { per_page: 1 },
          });
          result.permissions = {
            repo: repoResponse.data.length > 0 ? 'read' : 'none',
          };
        } catch (error) {
          result.errors.push(`Failed to check repository permissions: ${error}`);
        }
      }
    } catch (error) {
      result.canAccess = false;
      result.errors.push(`Access check failed: ${error}`);
    }

    return result;
  }

  /**
   * Get current rate limit status
   */
  async getRateLimit(): Promise<{ limit: number; remaining: number; reset: Date }> {
    const response = await this.client.get('/rate_limit');
    const rateData = response.data.resources.core;

    return {
      limit: rateData.limit,
      remaining: rateData.remaining,
      reset: new Date(rateData.reset * 1000),
    };
  }
}
