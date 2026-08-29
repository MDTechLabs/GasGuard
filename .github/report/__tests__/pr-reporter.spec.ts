import { GasGuardPullRequestReporter, PullRequestAnalysisReport } from '../pr-reporter';

describe('GasGuardPullRequestReporter', () => {
  let reporter: GasGuardPullRequestReporter;

  beforeEach(() => {
    reporter = new GasGuardPullRequestReporter();
  });

  it('should format a comprehensive markdown summary for pull requests', () => {
    const mockReport: PullRequestAnalysisReport = {
      pullRequestId: 844,
      repository: 'MDTechLabs/GasGuard',
      newFindings: [
        {
          ruleId: 'SOROBAN-STOR-01',
          severity: 'high',
          message: 'Frequent storage write detected inside a loop.',
          contractPath: 'contracts/vault.rs',
        },
      ],
      resolvedFindings: [
        {
          ruleId: 'SOROBAN-STOR-04',
          severity: 'medium',
          message: 'Redundant storage read detected.',
          contractPath: 'contracts/token.rs',
        },
      ],
      resourceChanges: {
        estimatedCpuDelta: -12500,
        estimatedMemoryDelta: -512,
        estimatedStorageCostDelta: -1000,
      },
      optimizationOpportunitiesCount: 2,
    };

    const markdown = reporter.generateMarkdownSummary(mockReport);

    expect(markdown).toContain('## 🛡️ GasGuard Pull Request Analysis');
    expect(markdown).toContain('SOROBAN-STOR-01');
    expect(markdown).toContain('SOROBAN-STOR-04');
    expect(markdown).toContain('-12500 instructions');
  });
});