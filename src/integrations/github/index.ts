/**
 * GitHub Integration Module
 * 
 * Provides comprehensive GitHub repository integration features including:
 * - Monorepo package boundaries detection (#1045)
 * - Private repository access diagnostics (#1048)
 * - Branch protection awareness (#1044)
 * - Repository language detection (#1046)
 */

export * from './types';
export * from './github-client';
export * from './monorepo-boundaries';
export * from './access-diagnostics';
export * from './branch-protection';
export * from './language-detection';

import { GitHubClient } from './github-client';
import { MonorepoBoundaryDetector } from './monorepo-boundaries';
import { AccessDiagnostics } from './access-diagnostics';
import { BranchProtectionAwareness } from './branch-protection';
import { LanguageDetector } from './language-detection';
import { GitHubAuthConfig, GitHubRepository, GitHubIntegrationConfig } from './types';

/**
 * Main GitHub Integration class that combines all features
 */
export class GitHubIntegration {
  private client: GitHubClient;
  private monorepoDetector: MonorepoBoundaryDetector;
  private accessDiagnostics: AccessDiagnostics;
  private branchProtection: BranchProtectionAwareness;
  private languageDetector: LanguageDetector;

  constructor(config: GitHubIntegrationConfig) {
    this.client = new GitHubClient(config.auth);
    this.monorepoDetector = new MonorepoBoundaryDetector(this.client);
    this.accessDiagnostics = new AccessDiagnostics(this.client, config.repository);
    this.branchProtection = new BranchProtectionAwareness(this.client, config.repository);
    this.languageDetector = new LanguageDetector(this.client, config.repository);
  }

  /**
   * Get the underlying GitHub client
   */
  getClient(): GitHubClient {
    return this.client;
  }

  /**
   * Get monorepo boundary detector
   */
  getMonorepoDetector(): MonorepoBoundaryDetector {
    return this.monorepoDetector;
  }

  /**
   * Get access diagnostics
   */
  getAccessDiagnostics(): AccessDiagnostics {
    return this.accessDiagnostics;
  }

  /**
   * Get branch protection awareness
   */
  getBranchProtection(): BranchProtectionAwareness {
    return this.branchProtection;
  }

  /**
   * Get language detector
   */
  getLanguageDetector(): LanguageDetector {
    return this.languageDetector;
  }

  private repository: GitHubRepository;

  constructor(config: GitHubIntegrationConfig) {
    this.repository = config.repository;
    this.client = new GitHubClient(config.auth);
    this.monorepoDetector = new MonorepoBoundaryDetector(this.client);
    this.accessDiagnostics = new AccessDiagnostics(this.client, config.repository);
    this.branchProtection = new BranchProtectionAwareness(this.client, config.repository);
    this.languageDetector = new LanguageDetector(this.client, config.repository);
  }

  /**
   * Run a comprehensive repository analysis
   */
  async analyzeRepository(): Promise<{
    monorepo: boolean;
    languages: any;
    branchProtection: any;
    access: any;
  }> {
    const results = {
      monorepo: false,
      languages: null,
      branchProtection: null,
      access: null,
    };

    try {
      // Check if monorepo
      if (this.monorepoDetector) {
        results.monorepo = await this.monorepoDetector.isMonorepo(
          this.repository.owner,
          this.repository.repo
        );
      }

      // Detect languages
      if (this.languageDetector) {
        results.languages = await this.languageDetector.detectLanguages();
      }

      // Get branch protection
      if (this.branchProtection) {
        results.branchProtection = await this.branchProtection.getDefaultBranchProtection();
      }

      // Run access diagnostics
      if (this.accessDiagnostics) {
        results.access = await this.accessDiagnostics.runDiagnostics();
      }
    } catch (error) {
      console.error('Repository analysis failed:', error);
    }

    return results;
  }
}
