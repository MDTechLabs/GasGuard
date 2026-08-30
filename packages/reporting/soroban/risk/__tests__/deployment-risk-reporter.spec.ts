import { SorobanDeploymentRiskScorer } from '../../../../analyzers/soroban/risk/deployment-risk-scorer';
import { DeploymentRiskReporter } from '../deployment-risk-reporter';
import { NormalizedFinding } from '../../../../analyzers/soroban/risk/types';

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeFindings(overrides: Partial<NormalizedFinding>[]): NormalizedFinding[] {
  return overrides.map((o, i) => ({
    ruleId: `RULE-${i}`,
    severity: 'medium' as const,
    message: `Finding ${i}`,
    category: 'security' as const,
    ...o,
  }));
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('DeploymentRiskReporter', () => {
  let scorer: SorobanDeploymentRiskScorer;
  let reporter: DeploymentRiskReporter;

  beforeEach(() => {
    scorer = new SorobanDeploymentRiskScorer();
    reporter = new DeploymentRiskReporter();
  });

  // ── buildReport ───────────────────────────────────────────────────────────

  describe('buildReport', () => {
    it('reflects the scored overall value', () => {
      const findings = makeFindings([{ severity: 'high', category: 'security' }]);
      const score = scorer.score(findings);
      const report = reporter.buildReport(score);

      expect(report.score.overall).toBe(score.overallScore);
      expect(report.score.grade).toBe(score.grade);
      expect(report.score.riskLevel).toBe(score.riskLevel);
    });

    it('includes contractId when provided', () => {
      const score = scorer.score([]);
      const report = reporter.buildReport(score, 'my-contract.wasm');
      expect(report.contractId).toBe('my-contract.wasm');
    });

    it('omits contractId when not provided', () => {
      const score = scorer.score([]);
      const report = reporter.buildReport(score);
      expect(report.contractId).toBeUndefined();
    });

    it('sets generatedAt to a valid ISO timestamp', () => {
      const score = scorer.score([]);
      const report = reporter.buildReport(score);
      expect(() => new Date(report.generatedAt)).not.toThrow();
    });

    it('maps top findings to the simplified shape', () => {
      const findings = makeFindings([
        { ruleId: 'CRIT-1', severity: 'critical', category: 'security', message: 'Test' },
      ]);
      const score = scorer.score(findings);
      const report = reporter.buildReport(score);

      expect(report.topFindings[0]).toMatchObject({
        ruleId: 'CRIT-1',
        severity: 'critical',
        category: 'security',
        message: 'Test',
      });
    });

    it('includes the raw score for downstream use', () => {
      const findings = makeFindings([{ severity: 'low', category: 'resource' }]);
      const score = scorer.score(findings);
      const report = reporter.buildReport(score);
      expect(report.raw).toBe(score);
    });

    it('reflects correct category counts', () => {
      const findings = makeFindings([
        { category: 'security', severity: 'high' },
        { category: 'security', severity: 'medium' },
        { category: 'deployment', severity: 'critical' },
      ]);
      const score = scorer.score(findings);
      const report = reporter.buildReport(score);

      const sec = report.categories.find((c) => c.category === 'security')!;
      const dep = report.categories.find((c) => c.category === 'deployment')!;
      expect(sec.count).toBe(2);
      expect(dep.count).toBe(1);
    });

    it('reports totalGasCost correctly', () => {
      const findings = makeFindings([
        { estimatedGasCost: 200 },
        { estimatedGasCost: 300 },
      ]);
      const score = scorer.score(findings);
      const report = reporter.buildReport(score);
      expect(report.totalGasCost).toBe(500);
    });
  });

  // ── toMarkdown ────────────────────────────────────────────────────────────

  describe('toMarkdown', () => {
    it('starts with the report heading', () => {
      const score = scorer.score([]);
      const report = reporter.buildReport(score);
      const md = reporter.toMarkdown(report);
      expect(md).toMatch(/# 🔐 Soroban Deployment Risk Report/);
    });

    it('includes the overall score in a table', () => {
      const findings = makeFindings([{ severity: 'high', category: 'security' }]);
      const score = scorer.score(findings);
      const report = reporter.buildReport(score);
      const md = reporter.toMarkdown(report);
      expect(md).toContain(`${score.overallScore}/100`);
    });

    it('includes the grade', () => {
      const score = scorer.score([]);
      const report = reporter.buildReport(score);
      const md = reporter.toMarkdown(report);
      expect(md).toContain(score.grade);
    });

    it('includes the risk level', () => {
      const findings = makeFindings([{ severity: 'critical', category: 'security' }]);
      const score = scorer.score(findings);
      const report = reporter.buildReport(score);
      const md = reporter.toMarkdown(report);
      expect(md.toLowerCase()).toContain('critical');
    });

    it('includes the contractId when provided', () => {
      const score = scorer.score([]);
      const report = reporter.buildReport(score, 'vault.wasm');
      const md = reporter.toMarkdown(report);
      expect(md).toContain('vault.wasm');
    });

    it('lists top findings', () => {
      const findings = makeFindings([
        { ruleId: 'AUTH-01', severity: 'critical', category: 'security', message: 'Missing auth' },
      ]);
      const score = scorer.score(findings);
      const report = reporter.buildReport(score);
      const md = reporter.toMarkdown(report);
      expect(md).toContain('AUTH-01');
      expect(md).toContain('Missing auth');
    });

    it('includes gas impact section when totalGasCost > 0', () => {
      const findings = makeFindings([{ estimatedGasCost: 800 }]);
      const score = scorer.score(findings);
      const report = reporter.buildReport(score);
      const md = reporter.toMarkdown(report);
      expect(md).toContain('Estimated Gas Impact');
    });

    it('omits gas impact section when totalGasCost is 0', () => {
      const score = scorer.score([]);
      const report = reporter.buildReport(score);
      const md = reporter.toMarkdown(report);
      expect(md).not.toContain('Estimated Gas Impact');
    });

    it('includes all recommendation bullets', () => {
      const findings = makeFindings([
        { severity: 'critical', category: 'security' },
        { severity: 'high', category: 'deployment' },
      ]);
      const score = scorer.score(findings);
      const report = reporter.buildReport(score);
      const md = reporter.toMarkdown(report);
      for (const rec of report.recommendations) {
        // check a fragment of each recommendation appears
        expect(md).toContain(rec.slice(0, 20));
      }
    });
  });
});
