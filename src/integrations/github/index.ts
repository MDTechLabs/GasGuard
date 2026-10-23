/**
 * GitHub Integration Module
 * 
 * Provides comprehensive GitHub repository integration features including:
 * - Monorepo package boundaries detection (#1045)
 * - Private repository access diagnostics (#1048)
 * - Branch protection awareness (#1044)
 * - Repository language detection (#1046)
 * - Pull request changed-file discovery (#1043)
 * - GitHub organization allowlists (#1042)
 * - GitHub repository installation validation (#1041)
 * - GitHub App permission minimization checks (#1244)
 */

export * from './types';
export * from './github-client';
export * from './monorepo-boundaries';
export * from './access-diagnostics';
export * from './branch-protection';
export * from './language-detection';
export * from './pull-request-discovery';
export * from './organization-allowlist';
export * from './installation-validator';
export * from './permission-minimization';
export * from './enterprise-config';
export * from './token-expiration';

import { GitHubClient } from './github-client';
import { MonorepoBoundaryDetector } from './monorepo-boundaries';
import { AccessDiagnostics } from './access-diagnostics';
import { BranchProtectionAwareness } from './branch-protection';
import { LanguageDetector } from './language-detection';
import { PullRequestFileDiscovery } from './pull-request-discovery';
import { OrganizationAllowlist } from './organization-allowlist';
import { InstallationValidator } from './installation-validator';
import { PermissionMinimizationChecker } from './permission-minimization';
import {
  GitHubRepository,
  GitHubIntegrationConfig,
  OrganizationAllowlistConfig,
} from './types';

export interface ExtendedGitHubIntegrationConfig extends GitHubIntegrationConfig {
  organizationAllowlist?: OrganizationAllowlistConfig;
}

/**
 * Main GitHub Integration class that combines all features
 */
export class GitHubIntegration {
  private repository: GitHubRepository;
  private client: GitHubClient;
  private monorepoDetector: MonorepoBoundaryDetector;
  private accessDiagnostics: AccessDiagnostics;
  private branchProtection: BranchProtectionAwareness;
  private languageDetector: LanguageDetector;
  private prDiscovery: PullRequestFileDiscovery;
  private allowlist?: OrganizationAllowlist;
  private installationValidator: InstallationValidator;
  private permissionMinimizationChecker: PermissionMinimizationChecker;

  constructor(config: ExtendedGitHubIntegrationConfig) {
    this.repository = config.repository;
    this.client = new GitHubClient(config.auth);
    this.monorepoDetector = new MonorepoBoundaryDetector(this.client);
    this.accessDiagnostics = new AccessDiagnostics(this.client, config.repository);
    this.branchProtection = new BranchProtectionAwareness(this.client, config.repository);
    this.languageDetector = new LanguageDetector(this.client, config.repository);
    this.prDiscovery = new PullRequestFileDiscovery(this.client, config.repository);
    this.installationValidator = new InstallationValidator(this.client, config.repository);
    this.permissionMinimizationChecker = new PermissionMinimizationChecker(this.client);

    if (config.organizationAllowlist) {
      this.allowlist = new OrganizationAllowlist(config.organizationAllowlist, this.client);
    }
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

  /**
   * Get pull request file discovery (#1043)
   */
  getPullRequestDiscovery(): PullRequestFileDiscovery {
    return this.prDiscovery;
  }

  /**
   * Get organization allowlist (#1042)
   */
  getOrganizationAllowlist(): OrganizationAllowlist | undefined {
    return this.allowlist;
  }

  /**
   * Get repository installation validator (#1041)
   */
  getInstallationValidator(): InstallationValidator {
    return this.installationValidator;
  }

  /**
   * Get the GitHub App permission minimization checker (#1244)
   */
  getPermissionMinimizationChecker(): PermissionMinimizationChecker {
    return this.permissionMinimizationChecker;
  }

  /**
   * Run a comprehensive repository analysis
   */
  async analyzeRepository(): Promise<{
    monorepo: boolean;
    languages: any;
    branchProtection: any;
    access: any;
    installation: any;
    permissionMinimization: any;
  }> {
    const results = {
      monorepo: false,
      languages: null,
      branchProtection: null,
      access: null,
      installation: null,
      permissionMinimization: null,
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

      // Validate installation
      if (this.installationValidator) {
        results.installation = await this.installationValidator.validateRepositoryInstallation();
      }

      // Check installation permission minimization
      if (this.permissionMinimizationChecker) {
        results.permissionMinimization =
          await this.permissionMinimizationChecker.checkRepositoryInstallation(
            this.repository.owner,
            this.repository.repo,
          );
      }
    } catch (error) {
      console.error('Repository analysis failed:', error);
    }

    return results;
  }
}
