import { Finding, Severity } from '@engine/core';
import { ImpactScorer } from './impact-scorer';
import { ImpactCategory, ImpactScore, ImpactReport } from './types';

describe('ImpactScorer', () => {
  let scorer: ImpactScorer;

  const criticalFinding: Finding = {
    ruleId: 'soroban-reentrancy',
    message: 'Potential reentrancy vulnerability in transfer function',
    severity: Severity.CRITICAL,
    location: {
      file: 'contracts/token.sol',
      startLine: 42,
      endLine: 45,
    },
  };

  const infoFinding: Finding = {
    ruleId: 'soroban-naming-convention',
    message: 'Function name does not follow snake_case convention',
    severity: Severity.INFO,
    location: {
      file: 'contracts/token.sol',
      startLine: 10,
      endLine: 10,
    },
  };

  beforeEach(() => {
    scorer = new ImpactScorer();
  });

  describe('scoreFinding', () => {
    it('should return a complete ImpactScore', () => {
      const score = scorer.scoreFinding(criticalFinding);
      expect(score).toBeDefined();
      expect(typeof score.overall).toBe('number');
      expect(score.factors).toHaveLength(4);
      expect(score.impactLevel).toBeDefined();
    });

    it('should assign critical impact level for critical severity findings', () => {
      const score = scorer.scoreFinding(criticalFinding);
      expect(score.impactLevel).toBe('critical');
    });

    it('should assign lower impact for informational findings', () => {
      const score = scorer.scoreFinding(infoFinding);
      expect(score.overall).toBeLessThan(
        scorer.scoreFinding(criticalFinding).overall,
      );
    });

    it('should include all four main impact factors', () => {
      const score = scorer.scoreFinding(criticalFinding);
      expect(score.exploitability).toBeGreaterThanOrEqual(0);
      expect(score.reachability).toBeGreaterThanOrEqual(0);
      expect(score.valueAtRisk).toBeGreaterThanOrEqual(0);
      expect(score.businessImpact).toBeGreaterThanOrEqual(0);
    });

    it('should have factors with correct categories', () => {
      const score = scorer.scoreFinding(criticalFinding);
      const categories = score.factors.map((f) => f.category);
      expect(categories).toContain(ImpactCategory.EXPLOITABILITY);
      expect(categories).toContain(ImpactCategory.REACHABILITY);
      expect(categories).toContain(ImpactCategory.VALUE_AT_RISK);
      expect(categories).toContain(ImpactCategory.BUSINESS_IMPACT);
    });

    it('should have each factor include score, weight, and description', () => {
      const score = scorer.scoreFinding(criticalFinding);
      for (const factor of score.factors) {
        expect(factor.score).toBeGreaterThanOrEqual(0);
        expect(factor.weight).toBeGreaterThan(0);
        expect(factor.description).toBeTruthy();
      }
    });
  });

  describe('scoreFindings', () => {
    it('should score multiple findings', () => {
      const findings = [criticalFinding, infoFinding];
      const scores = scorer.scoreFindings(findings);
      expect(scores).toHaveLength(2);
      expect(scores[0].overall).toBeGreaterThan(scores[1].overall);
    });

    it('should handle empty array', () => {
      const scores = scorer.scoreFindings([]);
      expect(scores).toHaveLength(0);
    });
  });

  describe('generateReport', () => {
    it('should generate a complete ImpactReport', () => {
      const report = scorer.generateReport(criticalFinding);
      expect(report.findingId).toBeDefined();
      expect(report.ruleId).toBe('soroban-reentrancy');
      expect(report.severity).toBe(Severity.CRITICAL);
      expect(report.impactScore).toBeDefined();
      expect(report.recommendations.length).toBeGreaterThan(0);
    });

    it('should include per-category breakdown', () => {
      const report = scorer.generateReport(criticalFinding);
      const breakdown = report.perCategoryBreakdown;
      expect(breakdown[ImpactCategory.EXPLOITABILITY]).toBeGreaterThanOrEqual(0);
      expect(breakdown[ImpactCategory.BUSINESS_IMPACT]).toBeGreaterThanOrEqual(0);
    });

    it('should include relevant recommendations for critical findings', () => {
      const report = scorer.generateReport(criticalFinding);
      expect(
        report.recommendations.some((r) =>
          r.toLowerCase().includes('immediate'),
        ),
      ).toBe(true);
    });

    it('should include timestamp', () => {
      const report = scorer.generateReport(criticalFinding);
      expect(report.generatedAt).toBeDefined();
      expect(new Date(report.generatedAt).toISOString()).toBe(
        report.generatedAt,
      );
    });
  });

  describe('generateReports', () => {
    it('should generate reports for multiple findings', () => {
      const findings = [criticalFinding, infoFinding];
      const reports = scorer.generateReports(findings);
      expect(reports).toHaveLength(2);
      expect(reports[0].severity).toBe(Severity.CRITICAL);
      expect(reports[1].severity).toBe(Severity.INFO);
    });
  });

  describe('configurable scoring', () => {
    it('should accept custom weights', () => {
      const customScorer = new ImpactScorer({
        weights: {
          [ImpactCategory.EXPLOITABILITY]: 20,
          [ImpactCategory.BUSINESS_IMPACT]: 5,
        },
      });
      const score = customScorer.scoreFinding(criticalFinding);
      expect(score.overall).toBeDefined();
    });

    it('should accept custom thresholds', () => {
      const customScorer = new ImpactScorer({
        thresholds: {
          critical: 90,
          high: 70,
          medium: 50,
          low: 25,
        },
      });
      const score = customScorer.scoreFinding(criticalFinding);
      expect(score.impactLevel).toBeDefined();
    });
  });

  describe('exploitability scoring', () => {
    it('should score auth-related findings higher', () => {
      const authFinding: Finding = {
        ...criticalFinding,
        ruleId: 'missing-auth',
        message: 'Missing access control in admin function',
      };
      const score = scorer.scoreFinding(authFinding);
      expect(score.exploitability).toBeGreaterThan(30);
    });

    it('should score gas findings with estimated savings', () => {
      const gasFinding: Finding = {
        ...criticalFinding,
        ruleId: 'gas-optimization',
        message: 'Gas expensive loop',
        severity: Severity.MEDIUM,
        estimatedGasSavings: 50000,
      };
      const score = scorer.scoreFinding(gasFinding);
      expect(score.overall).toBeGreaterThan(0);
    });
  });

  describe('impact level thresholds', () => {
    it('should return minimal for very low scores', () => {
      const score = scorer.scoreFinding(infoFinding);
      expect(['minimal', 'low']).toContain(score.impactLevel);
    });

    it('should not exceed 100 for overall score', () => {
      const score = scorer.scoreFinding(criticalFinding);
      expect(score.overall).toBeLessThanOrEqual(100);
    });
  });
});
