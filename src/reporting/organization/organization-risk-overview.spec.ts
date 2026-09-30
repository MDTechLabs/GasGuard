/**
 * Unit tests for Organization Risk Overview
 */

import {
  OrganizationMetadata,
  generateOrganizationRiskOverview,
  exportOrganizationRiskJSON,
  generateExecutiveSummary,
} from './organization-risk-overview';
import { RepositoryRiskSummary } from '../risk/repository-risk-summary';

describe('Organization Risk Overview', () => {
  const mockOrganization: OrganizationMetadata = {
    name: 'Test Organization',
    id: 'test-org-123',
    totalRepositories: 3,
    activeRepositories: 3,
    totalContributors: 15,
    createdAt: new Date('2025-01-01'),
    plan: 'enterprise',
  };

  const mockSummaries: RepositoryRiskSummary[] = [
    {
      summaryId: 'RISK-1',
      generatedAt: new Date(),
      repository: {
        name: 'repo-1',
        url: 'https://github.com/test/repo-1',
        defaultBranch: 'main',
        lastCommit: new Date(),
        contributors: 5,
        totalCommits: 100,
        openIssues: 5,
        openPullRequests: 2,
        languages: { TypeScript: 5000 },
      },
      riskScore: {
        overall: 80,
        security: 70,
        quality: 50,
        operational: 40,
        trend: 'degrading',
      },
      securityPosture: {
        totalVulnerabilities: 10,
        criticalVulnerabilities: 2,
        highVulnerabilities: 3,
        mediumVulnerabilities: 3,
        lowVulnerabilities: 2,
        exposedSecrets: 1,
        insecureDependencies: 2,
        securityScore: 50,
      },
      codeQuality: {
        linesOfCode: 10000,
        technicalDebtRatio: 20,
        codeSmells: 50,
        duplicatedLines: 200,
        complexity: 500,
        testCoverage: 70,
        documentationCoverage: 60,
      },
      dependencies: {
        total: 20,
        outdated: 5,
        vulnerable: 2,
        deprecated: 1,
        riskyDependencies: [],
      },
      riskCategories: [],
      criticalActions: ['Fix critical vulnerability'],
      recommendations: [],
      complianceStatus: {
        hasSecurityPolicy: true,
        hasLicenseFile: true,
        hasContributingGuide: true,
        hasDependencyScanning: true,
        hasCodeScanning: true,
        hasSecretScanning: false,
      },
      trend: {
        riskScoreChange: 5,
        findingsChange: 2,
        vulnerabilitiesChange: 1,
      },
    },
    {
      summaryId: 'RISK-2',
      generatedAt: new Date(),
      repository: {
        name: 'repo-2',
        url: 'https://github.com/test/repo-2',
        defaultBranch: 'main',
        lastCommit: new Date(),
        contributors: 3,
        totalCommits: 50,
        openIssues: 2,
        openPullRequests: 1,
        languages: { JavaScript: 3000 },
      },
      riskScore: {
        overall: 30,
        security: 20,
        quality: 30,
        operational: 25,
        trend: 'improving',
      },
      securityPosture: {
        totalVulnerabilities: 2,
        criticalVulnerabilities: 0,
        highVulnerabilities: 1,
        mediumVulnerabilities: 1,
        lowVulnerabilities: 0,
        exposedSecrets: 0,
        insecureDependencies: 0,
        securityScore: 85,
      },
      codeQuality: {
        linesOfCode: 5000,
        technicalDebtRatio: 10,
        codeSmells: 20,
        duplicatedLines: 50,
        complexity: 200,
        testCoverage: 85,
        documentationCoverage: 75,
      },
      dependencies: {
        total: 15,
        outdated: 2,
        vulnerable: 0,
        deprecated: 0,
        riskyDependencies: [],
      },
      riskCategories: [],
      criticalActions: [],
      recommendations: [],
      complianceStatus: {
        hasSecurityPolicy: false,
        hasLicenseFile: true,
        hasContributingGuide: false,
        hasDependencyScanning: true,
        hasCodeScanning: true,
        hasSecretScanning: true,
      },
      trend: {
        riskScoreChange: -5,
        findingsChange: -2,
        vulnerabilitiesChange: -1,
      },
    },
  ];

  describe('generateOrganizationRiskOverview', () => {
    it('should generate a complete organization risk overview', () => {
      const overview = generateOrganizationRiskOverview(mockOrganization, mockSummaries);

      expect(overview.overviewId).toMatch(/^ORG-RISK-/);
      expect(overview.generatedAt).toBeInstanceOf(Date);
      expect(overview.organization.name).toBe('Test Organization');
      expect(overview.repositories.length).toBe(2);
      expect(overview.metrics).toBeDefined();
      expect(overview.riskDistribution).toBeDefined();
      expect(overview.insights.length).toBeGreaterThan(0);
    });

    it('should calculate organization metrics correctly', () => {
      const overview = generateOrganizationRiskOverview(mockOrganization, mockSummaries);

      expect(overview.metrics.averageRiskScore).toBeGreaterThan(0);
      expect(overview.metrics.totalVulnerabilities).toBe(12);
      expect(overview.metrics.criticalVulnerabilities).toBe(2);
      expect(overview.metrics.trendsImproving).toBe(1);
      expect(overview.metrics.trendsDegrading).toBe(1);
    });

    it('should calculate risk distribution', () => {
      const overview = generateOrganizationRiskOverview(mockOrganization, mockSummaries);

      expect(overview.riskDistribution.critical).toBe(1); // repo-1 with score 80
      expect(overview.riskDistribution.medium).toBe(1); // repo-2 with score 30
    });

    it('should identify top risk repositories', () => {
      const overview = generateOrganizationRiskOverview(mockOrganization, mockSummaries);

      expect(overview.topRiskRepositories.length).toBeGreaterThan(0);
      expect(overview.topRiskRepositories[0].name).toBe('repo-1');
      expect(overview.topRiskRepositories[0].riskScore).toBe(80);
    });

    it('should generate organization insights', () => {
      const overview = generateOrganizationRiskOverview(mockOrganization, mockSummaries);

      expect(overview.insights.length).toBeGreaterThan(0);
      
      const criticalInsight = overview.insights.find(i => 
        i.message.includes('critical')
      );
      expect(criticalInsight).toBeDefined();
    });

    it('should generate recommendations', () => {
      const overview = generateOrganizationRiskOverview(mockOrganization, mockSummaries);

      expect(overview.recommendations.length).toBeGreaterThan(0);
      expect(overview.recommendations[0]).toBeTypeOf('string');
    });

    it('should calculate compliance overview', () => {
      const overview = generateOrganizationRiskOverview(mockOrganization, mockSummaries);

      expect(overview.complianceOverview.repositoriesWithSecurityPolicy).toBe(1);
      expect(overview.complianceOverview.repositoriesWithCodeScanning).toBe(2);
      expect(overview.complianceOverview.complianceRate).toBeGreaterThan(0);
      expect(overview.complianceOverview.complianceRate).toBeLessThanOrEqual(100);
    });

    it('should handle empty summaries array', () => {
      const overview = generateOrganizationRiskOverview(mockOrganization, []);

      expect(overview.metrics.averageRiskScore).toBe(0);
      expect(overview.repositories.length).toBe(0);
      expect(overview.topRiskRepositories.length).toBe(0);
    });
  });

  describe('exportOrganizationRiskJSON', () => {
    it('should export overview as JSON', () => {
      const overview = generateOrganizationRiskOverview(mockOrganization, mockSummaries);
      const json = exportOrganizationRiskJSON(overview);

      expect(json).toBeTypeOf('string');
      const parsed = JSON.parse(json);
      expect(parsed.overviewId).toBe(overview.overviewId);
    });
  });

  describe('generateExecutiveSummary', () => {
    it('should generate executive summary report', () => {
      const overview = generateOrganizationRiskOverview(mockOrganization, mockSummaries);
      const summary = generateExecutiveSummary(overview);

      expect(summary).toBeTypeOf('string');
      expect(summary).toContain('ORGANIZATION RISK OVERVIEW');
      expect(summary).toContain('Test Organization');
      expect(summary).toContain('Average Risk Score');
      expect(summary).toContain('RISK DISTRIBUTION');
    });

    it('should include top risk repositories in summary', () => {
      const overview = generateOrganizationRiskOverview(mockOrganization, mockSummaries);
      const summary = generateExecutiveSummary(overview);

      expect(summary).toContain('TOP RISK REPOSITORIES');
      expect(summary).toContain('repo-1');
    });

    it('should include compliance information', () => {
      const overview = generateOrganizationRiskOverview(mockOrganization, mockSummaries);
      const summary = generateExecutiveSummary(overview);

      expect(summary).toContain('COMPLIANCE OVERVIEW');
      expect(summary).toContain('Compliance Rate');
    });
  });
});
