/**
 * Example usage of the GitHub Integration Module
 * 
 * This file demonstrates how to use all four features:
 * - Monorepo package boundaries detection (#1045)
 * - Private repository access diagnostics (#1048)
 * - Branch protection awareness (#1044)
 * - Repository language detection (#1046)
 */

import {
  GitHubIntegration,
  GitHubClient,
  MonorepoBoundaryDetector,
  AccessDiagnostics,
  BranchProtectionAwareness,
  LanguageDetector,
  GitHubAuthConfig,
  GitHubRepository,
  GitHubIntegrationConfig,
} from './index';

/**
 * Example 1: Using the integrated GitHubIntegration class
 */
async function example1_IntegratedUsage() {
  console.log('=== Example 1: Integrated Usage ===\n');

  const config: GitHubIntegrationConfig = {
    auth: {
      token: process.env.GITHUB_TOKEN,
    },
    repository: {
      owner: 'MDTechLabs',
      repo: 'GasGuard',
      isPrivate: false,
      defaultBranch: 'main',
    },
    enableBranchProtectionAwareness: true,
    enableLanguageDetection: true,
    enablePackageBoundaries: true,
    enableAccessDiagnostics: true,
  };

  const integration = new GitHubIntegration(config);

  // Run comprehensive repository analysis
  const analysis = await integration.analyzeRepository();

  console.log('Repository Analysis Results:');
  console.log(`  Monorepo: ${analysis.monorepo}`);
  console.log(`  Primary Language: ${analysis.languages?.primaryLanguage}`);
  console.log(`  Branch Protected: ${analysis.branchProtection?.isProtected}`);
  console.log(`  Access OK: ${analysis.access?.canAccess}`);
}

/**
 * Example 2: Monorepo Package Boundaries Detection
 */
async function example2_MonorepoBoundaries() {
  console.log('\n=== Example 2: Monorepo Package Boundaries ===\n');

  const client = new GitHubClient({
    token: process.env.GITHUB_TOKEN,
  });

  const detector = new MonorepoBoundaryDetector(client);

  const owner = 'MDTechLabs';
  const repo = 'GasGuard';

  // Check if it's a monorepo
  const isMonorepo = await detector.isMonorepo(owner, repo);
  console.log(`Is monorepo: ${isMonorepo}`);

  if (isMonorepo) {
    // Detect package boundaries
    const boundaries = await detector.detectPackageBoundaries(owner, repo);
    console.log(`\nFound ${boundaries.length} package boundaries:`);

    for (const boundary of boundaries) {
      console.log(`\n  Package: ${boundary.packageName}`);
      console.log(`    Path: ${boundary.path}`);
      console.log(`    Languages: ${boundary.languages.join(', ')}`);
      console.log(`    Dependencies: ${boundary.dependencies.length}`);
      console.log(`    Has package.json: ${boundary.hasPackageJson}`);
    }

    // Validate boundaries
    const validation = await detector.validateBoundaries(boundaries);
    if (!validation.valid) {
      console.log('\n⚠️  Boundary violations detected:');
      validation.violations.forEach(v => console.log(`  - ${v}`));
    } else {
      console.log('\n✓ All boundaries are valid');
    }
  }
}

/**
 * Example 3: Private Repository Access Diagnostics
 */
async function example3_AccessDiagnostics() {
  console.log('\n=== Example 3: Access Diagnostics ===\n');

  const client = new GitHubClient({
    token: process.env.GITHUB_TOKEN,
  });

  const repository: GitHubRepository = {
    owner: 'MDTechLabs',
    repo: 'GasGuard',
    isPrivate: false,
    defaultBranch: 'main',
  };

  const diagnostics = new AccessDiagnostics(client, repository);

  // Run full diagnostics
  const result = await diagnostics.runDiagnostics();
  console.log(diagnostics.formatDiagnosticSummary(result));

  // Quick health check
  const health = await diagnostics.quickHealthCheck();
  console.log(`\nQuick Health Check: ${health.healthy ? '✓' : '✗'} ${health.message}`);
}

/**
 * Example 4: Branch Protection Awareness
 */
async function example4_BranchProtection() {
  console.log('\n=== Example 4: Branch Protection Awareness ===\n');

  const client = new GitHubClient({
    token: process.env.GITHUB_TOKEN,
  });

  const repository: GitHubRepository = {
    owner: 'MDTechLabs',
    repo: 'GasGuard',
    isPrivate: false,
    defaultBranch: 'main',
  };

  const protection = new BranchProtectionAwareness(client, repository);

  // Get default branch protection
  const defaultProtection = await protection.getDefaultBranchProtection();
  console.log(protection.formatProtectionSummary(defaultProtection));

  // Get protection impact
  const impact = await protection.getProtectionImpact('main');
  console.log('\nProtection Impact:');
  console.log(`  Requires Review: ${impact.requiresReview}`);
  console.log(`  Required Reviewers: ${impact.requiredReviewers}`);
  console.log(`  Requires Status Checks: ${impact.requiresStatusChecks}`);
  console.log(`  Required Checks: ${impact.requiredChecks.join(', ')}`);
  console.log(`  Blocks Force Push: ${impact.blocksForcePush}`);

  // Check if branch can be merged
  const mergeCheck = await protection.canMergeBranch('main', {
    hasRequiredApprovals: true,
    statusChecksPassed: ['ci', 'tests'],
  });

  console.log(`\nCan Merge: ${mergeCheck.canMerge ? '✓' : '✗'}`);
  if (!mergeCheck.canMerge) {
    console.log('Blockers:');
    mergeCheck.blockers.forEach(b => console.log(`  - ${b}`));
  }

  // Get all protected branches
  const protectedBranches = await protection.getProtectedBranches();
  console.log(`\nProtected Branches: ${protectedBranches.map(b => b.branch).join(', ')}`);
}

/**
 * Example 5: Repository Language Detection
 */
async function example5_LanguageDetection() {
  console.log('\n=== Example 5: Language Detection ===\n');

  const client = new GitHubClient({
    token: process.env.GITHUB_TOKEN,
  });

  const repository: GitHubRepository = {
    owner: 'MDTechLabs',
    repo: 'GasGuard',
    isPrivate: false,
    defaultBranch: 'main',
  };

  const detector = new LanguageDetector(client, repository);

  // Detect languages
  const analysis = await detector.detectLanguages();
  console.log(detector.formatLanguageAnalysis(analysis));

  // Check project types
  const isSmartContract = await detector.isSmartContractProject();
  const isWeb = await detector.isWebProject();
  console.log(`\nProject Type Detection:`);
  console.log(`  Smart Contract Project: ${isSmartContract ? '✓' : '✗'}`);
  console.log(`  Web Project: ${isWeb ? '✓' : '✗'}`);

  // Get file-level breakdown for src directory
  const breakdown = await detector.getFileLanguageBreakdown('src');
  console.log(`\nFiles in src/: ${breakdown.length}`);
  breakdown.slice(0, 5).forEach(file => {
    console.log(`  ${file.path}: ${file.language} (${file.percentage.toFixed(1)}%)`);
  });

  // Compare directories
  const comparison = await detector.compareDirectories('src', 'apps');
  if (comparison.differences.length > 0) {
    console.log('\nDifferences between src and apps:');
    comparison.differences.forEach(d => console.log(`  - ${d}`));
  }
}

/**
 * Example 6: Using individual components
 */
async function example6_IndividualComponents() {
  console.log('\n=== Example 6: Individual Components ===\n');

  const client = new GitHubClient({
    token: process.env.GITHUB_TOKEN,
  });

  // Check rate limit
  const rateLimit = await client.getRateLimit();
  console.log(`Rate Limit: ${rateLimit.remaining}/${rateLimit.limit} remaining`);
  console.log(`Resets at: ${rateLimit.reset.toISOString()}`);

  // Get repository info
  const repo = await client.getRepository('MDTechLabs', 'GasGuard');
  console.log(`\nRepository: ${repo.owner}/${repo.repo}`);
  console.log(`  Private: ${repo.isPrivate}`);
  console.log(`  Default Branch: ${repo.defaultBranch}`);

  // Get languages
  const languages = await client.getLanguages('MDTechLabs', 'GasGuard');
  console.log('\nLanguages:');
  Object.entries(languages).forEach(([lang, bytes]) => {
    console.log(`  ${lang}: ${bytes.toLocaleString()} bytes`);
  });
}

/**
 * Example 7: Error handling
 */
async function example7_ErrorHandling() {
  console.log('\n=== Example 7: Error Handling ===\n');

  const client = new GitHubClient({
    token: 'invalid-token',
  });

  try {
    await client.getRepository('MDTechLabs', 'GasGuard');
  } catch (error) {
    if (error instanceof Error) {
      console.log(`Error: ${error.message}`);
      
      if (error.message.includes('authentication')) {
        console.log('→ Please check your GitHub token');
      } else if (error.message.includes('rate limit')) {
        console.log('→ Rate limit exceeded, please wait');
      } else if (error.message.includes('not found')) {
        console.log('→ Repository not found');
      }
    }
  }
}

/**
 * Run all examples
 */
async function runAllExamples() {
  try {
    await example1_IntegratedUsage();
    await example2_MonorepoBoundaries();
    await example3_AccessDiagnostics();
    await example4_BranchProtection();
    await example5_LanguageDetection();
    await example6_IndividualComponents();
    await example7_ErrorHandling();
  } catch (error) {
    console.error('Example failed:', error);
  }
}

// Export examples for use in tests or other scripts
export {
  example1_IntegratedUsage,
  example2_MonorepoBoundaries,
  example3_AccessDiagnostics,
  example4_BranchProtection,
  example5_LanguageDetection,
  example6_IndividualComponents,
  example7_ErrorHandling,
  runAllExamples,
};

// Run examples if executed directly
if (require.main === module) {
  runAllExamples();
}
