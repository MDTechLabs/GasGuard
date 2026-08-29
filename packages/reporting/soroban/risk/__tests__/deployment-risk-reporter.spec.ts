import {
  calculateDeploymentRiskScore,
  DeploymentRiskFinding,
  DeploymentRiskScore,
} from '../../../../analyzers/soroban/risk';
import {
  formatDeploymentRiskCli,
  formatDeploymentRiskJson,
  formatDeploymentRiskMarkdown,
  formatDeploymentRiskPrComment,
  SorobanDeploymentRiskReporter,
} from '../deployment-risk-reporter';
import { RiskReportOptions } from '../types';

describe('SorobanDeploymentRiskReporter (#932)', () => {
  let reporter: SorobanDeploymentRiskReporter;
  let sampleScore: DeploymentRiskScore;

  beforeEach(() => {
    reporter = new SorobanDeploymentRiskReporter();

    const sampleFindings: DeploymentRiskFinding[] = [
      {
        id: 'sec-1',
        ruleId: 'soroban-missing-auth',
        category: 'security',
        severity: 'critical',
        message: 'Admin withdrawal entrypoint lacks caller authentication',
        suggestion: 'Add `admin.require_auth()` to guard withdrawal',
        line: 15,
        file: 'contracts/treasury.rs',
      },
      {
        id: 'res-1',
        ruleId: 'soroban-unbounded-loop',
        category: 'resource',
        severity: 'high',
        message: 'Unbounded iteration over active depositors',
        suggestion: 'Paginate batch distribution with MAX_BATCH_SIZE',
        line: 52,
        file: 'contracts/treasury.rs',
      },
      {
        id: 'dep-1',
        ruleId: 'soroban-missing-instance-ttl-extension',
        category: 'deployment',
        severity: 'medium',
        message: 'Instance storage does not extend TTL during execution',
        suggestion: 'Add `env.storage().instance().extend_ttl(...)`',
        line: 80,
        file: 'contracts/treasury.rs',
      },
    ];

    sampleScore = calculateDeploymentRiskScore(sampleFindings);
  });

  describe('Markdown Report Generation', () => {
    it('generates a full Markdown report with table, breakdown, and checklist', () => {
      const md = reporter.generateMarkdownReport(sampleScore, {
        contractName: 'TreasuryContract',
        targetNetwork: 'mainnet',
      });

      expect(md).toContain('## 🛡️ Soroban Deployment Risk Assessment: `TreasuryContract`');
      expect(md).toContain('Executive Summary');
      expect(md).toContain('Risk Breakdown by Category');
      expect(md).toContain('Detailed Findings');
      expect(md).toContain('Recommended Action Items');
      expect(md).toContain('Pre-Flight Deployment Checklist');
      expect(md).toContain('SECURITY');
      expect(md).toContain('RESOURCE');
      expect(md).toContain('DEPLOYMENT');
      expect(md).toContain('soroban-missing-auth');
      expect(md).toContain('Add `admin.require_auth()` to guard withdrawal');
    });

    it('formats clean contracts with passing status and all checklist items checked', () => {
      const cleanScore = calculateDeploymentRiskScore([]);
      const md = reporter.generateMarkdownReport(cleanScore);

      expect(md).toContain('READY FOR DEPLOYMENT');
      expect(md).toContain('[x] **Authentication & Access Control**');
      expect(md).toContain('[x] **Resource Budget**');
      expect(md).toContain('[x] **Deployment Lifecycle**');
      expect(md).toContain('[x] **Deployment Gate Approval**');
    });

    it('respects options to omit remediation or checklist', () => {
      const md = reporter.generateMarkdownReport(sampleScore, {
        includeRemediation: false,
        includeChecklist: false,
      });

      expect(md).not.toContain('### 🛠️ Recommended Action Items');
      expect(md).not.toContain('### ✅ Pre-Flight Deployment Checklist');
    });
  });

  describe('JSON Report Generation', () => {
    it('generates valid JSON with complete assessment structure', () => {
      const jsonStr = reporter.generateJsonReport(sampleScore, {
        contractName: 'TreasuryContract',
        targetNetwork: 'testnet',
      });

      const parsed = JSON.parse(jsonStr);

      expect(parsed.assessment).toBe('GasGuard Soroban Deployment Risk');
      expect(parsed.contractName).toBe('TreasuryContract');
      expect(parsed.targetNetwork).toBe('testnet');
      expect(parsed.compositeScore).toBe(sampleScore.compositeScore);
      expect(parsed.riskLevel).toBe(sampleScore.riskLevel);
      expect(parsed.categoryBreakdown.security).toBeDefined();
      expect(parsed.categoryBreakdown.resource).toBeDefined();
      expect(parsed.categoryBreakdown.deployment).toBeDefined();
      expect(parsed.findings).toHaveLength(3);
    });
  });

  describe('GitHub PR Comment Formatting', () => {
    it('formats a PR comment with status and category table', () => {
      const comment = reporter.formatPrRiskComment(sampleScore);

      expect(comment).toContain('## ⛽ GasGuard Soroban Deployment Risk Report');
      expect(comment).toContain('Deployment Status');
      expect(comment).toContain('| Category | Score | Weight | Findings | Highest Severity |');
      expect(comment).toContain('soroban-missing-auth');
      expect(comment).toContain('Top Action Items:');
    });

    it('collapses findings in PR comment when count exceeds threshold', () => {
      const manyFindings: DeploymentRiskFinding[] = Array.from({ length: 12 }, (_, i) => ({
        id: `f-${i}`,
        ruleId: `soroban-rule-${i}`,
        category: i % 2 === 0 ? 'resource' : 'deployment',
        severity: 'low',
        message: `Issue number ${i}`,
        suggestion: `Fix number ${i}`,
      }));

      const score = calculateDeploymentRiskScore(manyFindings);
      const comment = reporter.formatPrRiskComment(score, { collapseDetailsThreshold: 5 });

      expect(comment).toContain('<details>');
      expect(comment).toContain('View all 12 findings');
      expect(comment).toContain('</details>');
    });
  });

  describe('CLI Summary Formatting', () => {
    it('generates terminal friendly text output', () => {
      const cli = reporter.generateCliSummary(sampleScore);

      expect(cli).toContain('SOROBAN DEPLOYMENT RISK ASSESSMENT');
      expect(cli).toContain('Composite Score');
      expect(cli).toContain('Deployment Gate');
      expect(cli).toContain('SECURITY');
      expect(cli).toContain('RESOURCE');
      expect(cli).toContain('DEPLOYMENT');
      expect(cli).toContain('Blockers:');
      expect(cli).toContain('Remediation:');
    });
  });

  describe('Unified Report Method', () => {
    it('dispatches to corresponding format based on format option', () => {
      const reportMd = reporter.report(sampleScore, { format: 'markdown' });
      expect(reportMd.format).toBe('markdown');
      expect(reportMd.content).toContain('## 🛡️ Soroban Deployment Risk Assessment');

      const reportJson = reporter.report(sampleScore, { format: 'json' });
      expect(reportJson.format).toBe('json');
      expect(() => JSON.parse(reportJson.content)).not.toThrow();

      const reportPr = reporter.report(sampleScore, { format: 'pr-comment' });
      expect(reportPr.format).toBe('pr-comment');
      expect(reportPr.content).toContain('GasGuard Soroban Deployment Risk Report');

      const reportCli = reporter.report(sampleScore, { format: 'cli-summary' });
      expect(reportCli.format).toBe('cli-summary');
      expect(reportCli.content).toContain('SOROBAN DEPLOYMENT RISK ASSESSMENT');
    });
  });

  describe('Standalone Formatting Functions', () => {
    it('formats markdown via formatDeploymentRiskMarkdown', () => {
      const output = formatDeploymentRiskMarkdown(sampleScore);
      expect(output).toContain('## 🛡️ Soroban Deployment Risk Assessment');
    });

    it('formats PR comment via formatDeploymentRiskPrComment', () => {
      const output = formatDeploymentRiskPrComment(sampleScore);
      expect(output).toContain('## ⛽ GasGuard Soroban Deployment Risk Report');
    });

    it('formats JSON via formatDeploymentRiskJson', () => {
      const output = formatDeploymentRiskJson(sampleScore);
      expect(() => JSON.parse(output)).not.toThrow();
    });

    it('formats CLI via formatDeploymentRiskCli', () => {
      const output = formatDeploymentRiskCli(sampleScore);
      expect(output).toContain('SOROBAN DEPLOYMENT RISK ASSESSMENT');
    });
  });
});
