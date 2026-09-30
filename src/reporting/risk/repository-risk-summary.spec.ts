/**
 * Unit tests for Repository Risk Summary
 */

import {
  RiskFinding,
  DependencyRisk,
  CodeQualityMetrics,
  RepositoryMetadata,
  generateRepositoryRiskSummary,
  exportRiskSummaryJSON,
  generateRiskSummaryReport,
} from './repository-risk-summary';

describe('Repository Risk Summary', () => {
  const mockRepository: RepositoryMetadata = {
    name: 'test-repo',
    url: 'https://github.com/test/test-repo',
    defaultBranch: 'main',
    lastCommit: new Date('2026-09-30'),
    contributors: 5,
    totalCommits: 100,
    openIssues: 10,
    openPullRequests: 3,
    languages: { TypeScript: 5000, JavaScript: 2000 },
  };

  const mockFindings: RiskFinding[] = [
    {
      id: 'F001',
      ruleId: 'SEC001',
      severity: 'critical',
      category: 'security',
      filePath: 'src/auth.ts',
      line: 42,
      message: 'SQL injection vulnerability',
      detectedAt: new Date('2026-09-01'),
      status: 'open',
    },
    {
      id: 'F002',
      ruleId: 'PERF001',
      severity: 'high',
      category: 'performance',
      filePath: 'src/query.ts',
      line: 100,
      message: 'Inefficient database query',
      detectedAt: new Date('2026-09-02'),
      status: 'open',
    },
  ];

  const mockDependencies: DependencyRisk[] = [
    {
      name: 'vulnerable-lib',
      version: '1.0.0',
      vulnerabilities: 2,
      highestSeverity: 'high',
      latestVersion: '2.0.0',
      isDeprecated: false,
      lastUpdated: new Date('2026-01-01'),
    },
  ];

  const mockCodeQuality: CodeQualityMetrics = {
    linesOfCode: 10000,
    technicalDebtRatio: 15,
    codeSmells: 50,
    duplicatedLines: 200,
    complexity: 500,
    testCoverage: 75,
    documentationCoverage: 60,
  };

  describe('generateRepositoryRiskSummary', () => {
    it('should generate a complete risk summary', () => {
      const summary = generateRepositoryRiskSummary(
        mockRepository,
        mockFindings,
        mockDependencies,
        mockCodeQuality,
      );

      expect(summary.summaryId).toMatch(/^RISK-/);
      expect(summary.generatedAt).toBeInstanceOf(Date);
      expect(summary.repository.name).toBe('test-repo');
      expect(summary.riskScore.overall).toBeGreaterThan(0);
      expect(summary.securityPosture).toBeDefined();
      expect(summary.codeQuality).toBeDefined();
      expect(summary.dependencies.total).toBe(1);
      expect(summary.riskCategories.length).toBe(4);
    });

    it('should calculate security posture correctly', () => {
      const summary = generateRepositoryRiskSummary(
        mockRepository,
        mockFindings,
        mockDependencies,
        mockCodeQuality,
      );

      expect(summary.securityPosture.totalVulnerabilities).toBe(1);
      expect(summary.securityPosture.criticalVulnerabilities).toBe(1);
      expect(summary.securityPosture.securityScore).toBeGreaterThan(0);
      expect(summary.securityPosture.securityScore).toBeLessThanOrEqual(100);
    });

    it('should calculate risk scores', () => {
      const summary = generateRepositoryRiskSummary(
        mockRepository,
        mockFindings,
        mockDependencies,
        mockCodeQuality,
      );

      expect(summary.riskScore.overall).toBeGreaterThanOrEqual(0);
      expect(summary.riskScore.overall).toBeLessThanOrEqual(100);
      expect(summary.riskScore.security).toBeDefined();
      expect(summary.riskScore.quality).toBeDefined();
      expect(summary.riskScore.operational).toBeDefined();
    });

    it('should identify critical actions', () => {
      const summary = generateRepositoryRiskSummary(
        mockRepository,
        mockFindings,
        mockDependencies,
        mockCodeQuality,
      );

      expect(summary.criticalActions.length).toBeGreaterThan(0);
      expect(summary.criticalActions[0]).toContain('critical');
    });

    it('should generate recommendations', () => {
      const summary = generateRepositoryRiskSummary(
        mockRepository,
        mockFindings,
        mockDependencies,
        mockCodeQuality,
      );

      expect(summary.recommendations.length).toBeGreaterThan(0);
      expect(summary.recommendations[0]).toBeTypeOf('string');
    });

    it('should categorize risks correctly', () => {
      const summary = generateRepositoryRiskSummary(
        mockRepository,
        mockFindings,
        mockDependencies,
        mockCodeQuality,
      );

      const securityCategory = summary.riskCategories.find(c => c.name === 'security');
      expect(securityCategory).toBeDefined();
      expect(securityCategory?.findingsCount).toBe(1);
      expect(securityCategory?.level).toBe('critical');
    });

    it('should calculate trend when previous summary provided', () => {
      const firstSummary = generateRepositoryRiskSummary(
        mockRepository,
        mockFindings,
        mockDependencies,
        mockCodeQuality,
      );

      const newFindings = [...mockFindings, {
        id: 'F003',
        ruleId: 'SEC002',
        severity: 'high',
        category: 'security' as const,
        filePath: 'src/api.ts',
        line: 50,
        message: 'XSS vulnerability',
        detectedAt: new Date('2026-09-03'),
        status: 'open' as const,
      }];

      const secondSummary = generateRepositoryRiskSummary(
        mockRepository,
        newFindings,
        mockDependencies,
        mockCodeQuality,
        firstSummary,
      );

      expect(secondSummary.trend.findingsChange).toBe(1);
      expect(secondSummary.riskScore.previousScore).toBe(firstSummary.riskScore.overall);
    });
  });

  describe('exportRiskSummaryJSON', () => {
    it('should export summary as JSON', () => {
      const summary = generateRepositoryRiskSummary(
        mockRepository,
        mockFindings,
        mockDependencies,
        mockCodeQuality,
      );

      const json = exportRiskSummaryJSON(summary);
      expect(json).toBeTypeOf('string');
      
      const parsed = JSON.parse(json);
      expect(parsed.summaryId).toBe(summary.summaryId);
    });
  });

  describe('generateRiskSummaryReport', () => {
    it('should generate human-readable report', () => {
      const summary = generateRepositoryRiskSummary(
        mockRepository,
        mockFindings,
        mockDependencies,
        mockCodeQuality,
      );

      const report = generateRiskSummaryReport(summary);
      expect(report).toBeTypeOf('string');
      expect(report).toContain('REPOSITORY RISK SUMMARY REPORT');
      expect(report).toContain('test-repo');
      expect(report).toContain('Overall Risk');
      expect(report).toContain('Security Score');
    });

    it('should include critical actions in report', () => {
      const summary = generateRepositoryRiskSummary(
        mockRepository,
        mockFindings,
        mockDependencies,
        mockCodeQuality,
      );

      const report = generateRiskSummaryReport(summary);
      if (summary.criticalActions.length > 0) {
        expect(report).toContain('CRITICAL ACTIONS REQUIRED');
      }
    });
  });
});
