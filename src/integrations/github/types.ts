/**
 * GitHub Integration Types
 * 
 * Defines types and interfaces for GitHub repository integration features
 * including branch protection, language detection, package boundaries, and access diagnostics.
 */

export interface GitHubRepository {
  owner: string;
  repo: string;
  isPrivate: boolean;
  defaultBranch: string;
}

export interface GitHubAuthConfig {
  token?: string;
  appId?: string;
  installationId?: string;
  privateKey?: string;
}

export interface BranchProtectionRule {
  pattern: string;
  requiresApprovingReviews: boolean;
  requiredApprovingReviewCount: number;
  requiresStatusChecks: boolean;
  requiredStatusCheckContexts: string[];
  requiresCodeOwnerReviews: boolean;
  requiresLinearHistory: boolean;
  allowsDeletions: boolean;
  allowsForcePushes: boolean;
  restrictsPushes: boolean;
  restrictsReviewDismissals: boolean;
}

export interface RepositoryLanguage {
  language: string;
  byteCount: number;
  percentage: number;
}

export interface MonorepoPackageBoundary {
  packageName: string;
  path: string;
  languages: string[];
  dependencies: string[];
  hasPackageJson: boolean;
  hasCargoToml: boolean;
  hasGoMod: boolean;
  hasPyProject: boolean;
}

export interface AccessDiagnosticResult {
  canAccess: boolean;
  isAuthenticated: boolean;
  hasRequiredScopes: string[];
  missingScopes: string[];
  permissions: Record<string, string>;
  rateLimit: {
    limit: number;
    remaining: number;
    reset: Date;
  };
  errors: string[];
}

export interface GitHubIntegrationConfig {
  auth: GitHubAuthConfig;
  repository: GitHubRepository;
  enableBranchProtectionAwareness: boolean;
  enableLanguageDetection: boolean;
  enablePackageBoundaries: boolean;
  enableAccessDiagnostics: boolean;
}
