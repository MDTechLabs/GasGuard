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
  /** GitHub Enterprise Server URL; defaults to github.com */
  baseUrl?: string;
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

// --- Pull Request File Discovery (#1043) ---
export interface PullRequestFile {
  sha: string;
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  additions: number;
  deletions: number;
  changes: number;
  blobUrl?: string;
  rawUrl?: string;
  contentsUrl?: string;
  patch?: string;
  previousFilename?: string;
}

export interface PullRequestChangeSummary {
  totalFiles: number;
  additions: number;
  deletions: number;
  changes: number;
  files: PullRequestFile[];
  filesByStatus: Record<string, number>;
  affectedFileTypes: Record<string, number>;
  hasSecurityOrConfigFileChanges: boolean;
  criticalFilesTouched: string[];
}

export interface PullRequestDiscoveryOptions {
  maxFiles?: number;
  fileExtensions?: string[];
  excludePatterns?: string[];
  includePatch?: boolean;
}

// --- GitHub Organization Allowlist (#1042) ---
export interface OrganizationAllowlistConfig {
  allowedOrganizations: string[];
  allowWildcards?: boolean;
  strictCase?: boolean;
  cacheTtlSeconds?: number;
  requireVerifiedMembers?: boolean;
}

export interface OrganizationValidationResult {
  allowed: boolean;
  organization: string;
  matchedPattern?: string;
  reason?: string;
  timestamp: Date;
  isMember?: boolean;
}

// --- GitHub App Repository Installation Validation (#1041) ---
export interface InstallationValidationResult {
  valid: boolean;
  installationId?: number;
  targetType: 'User' | 'Organization' | 'Unknown';
  targetId?: number;
  repositorySelection: 'all' | 'selected';
  permissions: Record<string, string>;
  missingRequiredPermissions: string[];
  status: 'active' | 'suspended' | 'not_installed' | 'unauthorized';
  suspendedAt?: Date | null;
  suspendedBy?: string | null;
  errors: string[];
  details?: string;
}

export interface InstallationValidationOptions {
  requiredPermissions?: Record<string, string>;
  checkAccess?: boolean;
}
