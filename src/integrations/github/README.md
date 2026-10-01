# GitHub Integration Module

This module provides comprehensive GitHub repository integration features for GasGuard, including:

- **Monorepo Package Boundaries Detection** (#1045) - Detect and analyze package boundaries in monorepo structures
- **Private Repository Access Diagnostics** (#1048) - Comprehensive diagnostics for accessing private GitHub repositories
- **Branch Protection Awareness** (#1044) - Understand and work with GitHub branch protection rules
- **Repository Language Detection** (#1046) - Detect and analyze programming languages used in repositories

## Installation

The module is part of the GasGuard codebase. Import from:

```typescript
import {
  GitHubIntegration,
  GitHubClient,
  MonorepoBoundaryDetector,
  AccessDiagnostics,
  BranchProtectionAwareness,
  LanguageDetector,
} from '@/integrations/github';
```

## Configuration

### Basic Setup

```typescript
import { GitHubIntegration } from '@/integrations/github';

const integration = new GitHubIntegration({
  auth: {
    token: process.env.GITHUB_TOKEN, // Personal access token or app token
  },
  repository: {
    owner: 'owner-name',
    repo: 'repo-name',
    isPrivate: true,
    defaultBranch: 'main',
  },
  enableBranchProtectionAwareness: true,
  enableLanguageDetection: true,
  enablePackageBoundaries: true,
  enableAccessDiagnostics: true,
});
```

### Using Individual Components

```typescript
import { GitHubClient } from '@/integrations/github';

const client = new GitHubClient({
  token: process.env.GITHUB_TOKEN,
});
```

## Features

### 1. Monorepo Package Boundaries Detection

Detect and analyze package boundaries in monorepo structures to understand dependencies and enforce clean architecture.

```typescript
import { MonorepoBoundaryDetector } from '@/integrations/github';

const detector = new MonorepoBoundaryDetector(client);

// Check if repository is a monorepo
const isMonorepo = await detector.isMonorepo('owner', 'repo');
console.log(`Is monorepo: ${isMonorepo}`);

// Detect all package boundaries
const boundaries = await detector.detectPackageBoundaries('owner', 'repo');
console.log('Package boundaries:', boundaries);

// Validate boundaries for issues
const validation = await detector.validateBoundaries(boundaries);
if (!validation.valid) {
  console.error('Boundary violations:', validation.violations);
}
```

**Example Output:**

```typescript
{
  packageName: 'apps/web',
  path: 'apps/web',
  languages: ['TypeScript', 'JavaScript'],
  dependencies: ['@shared/utils', '@shared/types'],
  hasPackageJson: true,
  hasCargoToml: false,
  hasGoMod: false,
  hasPyProject: false,
}
```

### 2. Private Repository Access Diagnostics

Comprehensive diagnostics for accessing private GitHub repositories, including authentication verification, permission checks, and rate limit monitoring.

```typescript
import { AccessDiagnostics } from '@/integrations/github';

const diagnostics = new AccessDiagnostics(client, repository);

// Run full diagnostics
const result = await diagnostics.runDiagnostics();
console.log(diagnostics.formatDiagnosticSummary(result));

// Quick health check
const health = await diagnostics.quickHealthCheck();
console.log(`Health: ${health.healthy} - ${health.message}`);
```

**Example Output:**

```
=== GitHub Access Diagnostics ===
Authenticated: ✓
Can Access: ✓

Rate Limit:
  Limit: 5000
  Remaining: 4999
  Resets: 2024-01-15T12:00:00.000Z

Scopes:
  ✓ repo
  ✓ read:org

Permissions:
  user: username
  repo: read
  org: read

No errors detected.
```

### 3. Branch Protection Awareness

Understand and work with GitHub branch protection rules to adjust analysis workflows based on governance requirements.

```typescript
import { BranchProtectionAwareness } from '@/integrations/github';

const protection = new BranchProtectionAwareness(client, repository);

// Get protection for a specific branch
const summary = await protection.getBranchProtection('main');
console.log(protection.formatProtectionSummary(summary));

// Get protection impact
const impact = await protection.getProtectionImpact('main');
console.log('Requires review:', impact.requiresReview);
console.log('Required reviewers:', impact.requiredReviewers);

// Check if branch can be merged
const canMerge = await protection.canMergeBranch('main', {
  hasRequiredApprovals: true,
  statusChecksPassed: ['ci', 'tests'],
});
console.log('Can merge:', canMerge.canMerge);
console.log('Blockers:', canMerge.blockers);

// Get all protected branches
const protectedBranches = await protection.getProtectedBranches();
console.log('Protected branches:', protectedBranches.map(b => b.branch));
```

**Example Output:**

```
=== Branch Protection: main ===
Protected: ✓

Rules:
  Pattern: main
  Requires Reviews: ✓
  Required Reviewers: 2
  Code Owner Reviews: ✓
  Requires Status Checks: ✓
  Required Checks: ci, tests
  Linear History: ✓
  Allows Deletions: ✗
  Allows Force Push: ✗
```

### 4. Repository Language Detection

Detect and analyze the programming languages used in a repository for tooling and analysis decisions.

```typescript
import { LanguageDetector } from '@/integrations/github';

const detector = new LanguageDetector(client, repository);

// Detect languages
const analysis = await detector.detectLanguages();
console.log(detector.formatLanguageAnalysis(analysis));

// Check if smart contract project
const isSmartContract = await detector.isSmartContractProject();
console.log('Is smart contract project:', isSmartContract);

// Check if web project
const isWeb = await detector.isWebProject();
console.log('Is web project:', isWeb);

// Get file-level breakdown
const breakdown = await detector.getFileLanguageBreakdown('src');
console.log('File breakdown:', breakdown);

// Compare directories
const comparison = await detector.compareDirectories('src', 'lib');
console.log('Differences:', comparison.differences);
```

**Example Output:**

```
=== Repository Language Analysis ===
Primary Language: TypeScript
Total Bytes: 150,000
Diversity Score: 0.92
Polyglot: Yes

Languages:
  TypeScript: 66.7% (100,000 bytes)
  JavaScript: 33.3% (50,000 bytes)

Recommended Tools:
  - eslint
  - prettier
  - typescript
```

## Combined Usage

Run a comprehensive repository analysis:

```typescript
import { GitHubIntegration } from '@/integrations/github';

const integration = new GitHubIntegration(config);

// Analyze repository
const analysis = await integration.analyzeRepository();

console.log('Monorepo:', analysis.monorepo);
console.log('Languages:', analysis.languages);
console.log('Branch Protection:', analysis.branchProtection);
console.log('Access:', analysis.access);
```

## Error Handling

All components include comprehensive error handling:

```typescript
try {
  const boundaries = await detector.detectPackageBoundaries('owner', 'repo');
} catch (error) {
  if (error.message.includes('rate limit')) {
    console.error('Rate limit exceeded, please wait');
  } else if (error.message.includes('authentication')) {
    console.error('Authentication failed, check your token');
  } else {
    console.error('Unexpected error:', error);
  }
}
```

## Rate Limiting

The GitHub Client automatically handles rate limiting:

```typescript
const client = new GitHubClient({ token: process.env.GITHUB_TOKEN });

// Check current rate limit
const rateLimit = await client.getRateLimit();
console.log(`Remaining: ${rateLimit.remaining}/${rateLimit.limit}`);
console.log(`Resets at: ${rateLimit.reset}`);
```

## Security Considerations

- Never commit GitHub tokens to repository
- Use environment variables for sensitive credentials
- Use the minimum required scopes for your token
- Regularly rotate access tokens
- Consider using GitHub Apps for production deployments

**Required scopes:**

- `repo` - For private repository access
- `read:org` - For organization access (if needed)
- `admin:org_hook` - For branch protection access (if needed)

## Testing

Run the unit tests:

```bash
npm test -- src/integrations/github/__tests__
```

## API Reference

### GitHubClient

Main client for GitHub API interactions.

- `getRepository(owner, repo)` - Get repository information
- `getBranchProtection(owner, repo, branch)` - Get branch protection rules
- `getLanguages(owner, repo)` - Get repository languages
- `getContents(owner, repo, path, ref?)` - Get repository contents
- `getTree(owner, repo, sha, recursive?)` - Get git tree
- `runAccessDiagnostics()` - Run access diagnostics
- `getRateLimit()` - Get rate limit status

### MonorepoBoundaryDetector

Detect and analyze monorepo package boundaries.

- `isMonorepo(owner, repo)` - Check if repository is a monorepo
- `detectPackageBoundaries(owner, repo)` - Detect all package boundaries
- `validateBoundaries(boundaries)` - Validate boundaries for issues

### AccessDiagnostics

Diagnostics for private repository access.

- `runDiagnostics(options?)` - Run comprehensive diagnostics
- `quickHealthCheck()` - Quick health check
- `formatDiagnosticSummary(result)` - Format diagnostic results

### BranchProtectionAwareness

Branch protection awareness and analysis.

- `getBranchProtection(branch)` - Get protection for a branch
- `getAllBranchProtections()` - Get all branch protections
- `getProtectionImpact(branch)` - Get protection impact
- `canMergeBranch(branch, context)` - Check if branch can be merged
- `getProtectedBranches()` - Get protected branches only
- `getDefaultBranchProtection()` - Get default branch protection
- `compareBranchProtection(branch1, branch2)` - Compare branch protections

### LanguageDetector

Repository language detection and analysis.

- `detectLanguages()` - Detect repository languages
- `detectLanguageFromFile(filename)` - Detect language from file name
- `isSmartContractProject()` - Check if smart contract project
- `isWebProject()` - Check if web project
- `getFileLanguageBreakdown(path?)` - Get file-level breakdown
- `getDirectoryLanguageStats(directory)` - Get directory language stats
- `compareDirectories(dir1, dir2)` - Compare directory languages
- `formatLanguageAnalysis(analysis)` - Format language analysis

## Troubleshooting

### Authentication Issues

If you encounter authentication errors:

1. Verify your GitHub token is valid
2. Check that the token has required scopes
3. Run access diagnostics: `await diagnostics.runDiagnostics()`

### Rate Limit Issues

If you hit rate limits:

1. Check remaining calls: `await client.getRateLimit()`
2. Wait for the reset time
3. Consider using authentication for higher limits

### Branch Protection Access

If you can't access branch protection:

1. Verify you have admin access to the repository
2. Check that your token has `admin:org_hook` scope
3. Ensure branch protection is enabled on the branch

## Contributing

When adding new features to this module:

1. Follow the existing code structure
2. Add comprehensive unit tests
3. Update this README with usage examples
4. Ensure error handling is robust
5. Add TypeScript types for all new interfaces

## License

This module is part of GasGuard and follows the same license.
