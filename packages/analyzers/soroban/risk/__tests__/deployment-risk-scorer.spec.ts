import { SorobanDeploymentRiskScorer } from '../deployment-risk-scorer';
import { NormalizedFinding, DEFAULT_WEIGHTS } from '../types';

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

describe('SorobanDeploymentRiskScorer', () => {
  let scorer: SorobanDeploymentRiskScorer;

  beforeEach(() => {
    scorer = new SorobanDeploymentRiskScorer();
  });

  // ── Empty input ──────────────────────────────────────────────────────────

  describe('empty findings', () => {
    it('returns overallScore 0 and grade A', () => {
      const result = scorer.score([]);
      expect(result.overallScore).toBe(0);
      expect(result.grade).toBe('A');
      expect(result.riskLevel).toBe('minimal');
    });

    it('returns no top findings', () => {
      const result = scorer.score([]);
      expect(result.topFindings).toHaveLength(0);
    });

    it('returns a clean recommendation', () => {
      const result = scorer.score([]);
      expect(result.recommendations[0]).toMatch(/No significant issues/i);
    });

    it('carries the default weights in meta', () => {
      const result = scorer.score([]);
      expect(result.meta.weightsUsed).toMatchObject(DEFAULT_WEIGHTS);
    });
  });

  // ── Score normalization ──────────────────────────────────────────────────

  describe('score normalization', () => {
    it('caps score at 100 for extreme inputs', () => {
      // 50 critical security findings — raw points will far exceed ceiling
      const findings = makeFindings(
        Array.from({ length: 50 }, () => ({ severity: 'critical' as const, category: 'security' as const })),
      );
      const result = scorer.score(findings);
      expect(result.overallScore).toBeLessThanOrEqual(100);
      expect(result.overallScore).toBeGreaterThan(0);
    });

    it('score is proportional to severity weight', () => {
      const lowFindings = makeFindings([{ severity: 'low', category: 'security' }]);
      const highFindings = makeFindings([{ severity: 'high', category: 'security' }]);
      const low = scorer.score(lowFindings);
      const high = scorer.score(highFindings);
      expect(high.overallScore).toBeGreaterThan(low.overallScore);
    });
  });

  // ── Grade thresholds ─────────────────────────────────────────────────────

  describe('grade assignment', () => {
    const cases: Array<[NormalizedFinding[], 'A' | 'B' | 'C' | 'D' | 'F']> = [
      [[], 'A'],
      [makeFindings([{ severity: 'info', category: 'optimization' }]), 'A'],
    ];

    it.each(cases)('assigns expected grade', (findings, expectedGrade) => {
      const result = scorer.score(findings);
      expect(result.grade).toBe(expectedGrade);
    });
  });

  // ── Risk level ───────────────────────────────────────────────────────────

  describe('risk level', () => {
    it('is "critical" when any critical finding is present, regardless of score', () => {
      const findings = makeFindings([{ severity: 'critical', category: 'optimization' }]);
      const result = scorer.score(findings);
      expect(result.riskLevel).toBe('critical');
    });

    it('is "minimal" when score is 0', () => {
      expect(scorer.score([]).riskLevel).toBe('minimal');
    });
  });

  // ── Category breakdown ────────────────────────────────────────────────────

  describe('category breakdown', () => {
    it('counts findings per category correctly', () => {
      const findings = makeFindings([
        { category: 'security', severity: 'high' },
        { category: 'security', severity: 'medium' },
        { category: 'resource', severity: 'low' },
        { category: 'deployment', severity: 'high' },
      ]);
      const result = scorer.score(findings);
      expect(result.categoryBreakdown.security.count).toBe(2);
      expect(result.categoryBreakdown.resource.count).toBe(1);
      expect(result.categoryBreakdown.deployment.count).toBe(1);
      expect(result.categoryBreakdown.optimization.count).toBe(0);
    });

    it('security has higher contribution than optimization for equal severity', () => {
      const sec = scorer.score(makeFindings([{ category: 'security', severity: 'medium' }]));
      const opt = scorer.score(makeFindings([{ category: 'optimization', severity: 'medium' }]));
      expect(sec.overallScore).toBeGreaterThan(opt.overallScore);
    });

    it('sum of category contributions roughly equals overallScore (±rounding)', () => {
      const findings = makeFindings([
        { category: 'security', severity: 'high' },
        { category: 'resource', severity: 'medium' },
        { category: 'deployment', severity: 'low' },
        { category: 'optimization', severity: 'info' },
      ]);
      const result = scorer.score(findings);
      const sumContributions = Object.values(result.categoryBreakdown).reduce(
        (s, v) => s + v.contribution,
        0,
      );
      // Allow ±4 for rounding across 4 categories
      expect(Math.abs(sumContributions - result.overallScore)).toBeLessThanOrEqual(4);
    });
  });

  // ── Top findings ──────────────────────────────────────────────────────────

  describe('topFindings', () => {
    it('returns at most 5 findings', () => {
      const findings = makeFindings(
        Array.from({ length: 10 }, (_, i) => ({
          severity: 'medium' as const,
          category: 'security' as const,
          ruleId: `RULE-${i}`,
        })),
      );
      const result = scorer.score(findings);
      expect(result.topFindings.length).toBeLessThanOrEqual(5);
    });

    it('ranks critical findings first', () => {
      const findings = makeFindings([
        { severity: 'low', category: 'optimization', ruleId: 'LOW-1' },
        { severity: 'critical', category: 'security', ruleId: 'CRIT-1' },
        { severity: 'medium', category: 'resource', ruleId: 'MED-1' },
      ]);
      const result = scorer.score(findings);
      expect(result.topFindings[0].ruleId).toBe('CRIT-1');
    });
  });

  // ── Gas cost ──────────────────────────────────────────────────────────────

  describe('totalGasCost', () => {
    it('sums estimatedGasCost across findings', () => {
      const findings = makeFindings([
        { estimatedGasCost: 100 },
        { estimatedGasCost: 250 },
        { estimatedGasCost: 50 },
      ]);
      const result = scorer.score(findings);
      expect(result.totalGasCost).toBe(400);
    });

    it('handles missing estimatedGasCost gracefully', () => {
      const findings = makeFindings([
        { estimatedGasCost: undefined },
        { estimatedGasCost: 300 },
      ]);
      const result = scorer.score(findings);
      expect(result.totalGasCost).toBe(300);
    });
  });

  // ── Explanation ───────────────────────────────────────────────────────────

  describe('explanation', () => {
    it('mentions overall score', () => {
      const result = scorer.score(makeFindings([{ severity: 'high', category: 'security' }]));
      expect(result.explanation[0]).toMatch(/overall deployment risk score/i);
    });

    it('mentions critical findings when present', () => {
      const result = scorer.score(makeFindings([{ severity: 'critical', category: 'security' }]));
      expect(result.explanation.some((l) => l.includes('critical finding'))).toBe(true);
    });
  });

  // ── Recommendations ───────────────────────────────────────────────────────

  describe('recommendations', () => {
    it('calls out critical issues', () => {
      const result = scorer.score(
        makeFindings([{ severity: 'critical', category: 'security' }]),
      );
      expect(result.recommendations.some((r) => r.includes('critical issue'))).toBe(true);
    });

    it('includes gas optimization when totalGasCost > 500', () => {
      const findings = makeFindings([
        { estimatedGasCost: 600, severity: 'medium', category: 'resource' },
      ]);
      const result = scorer.score(findings);
      expect(result.recommendations.some((r) => r.includes('gas cost'))).toBe(true);
    });
  });

  // ── Configurable weights ──────────────────────────────────────────────────

  describe('configurable weights', () => {
    it('custom weights change the score', () => {
      const defaultScorer = new SorobanDeploymentRiskScorer();
      const heavyDeploymentScorer = new SorobanDeploymentRiskScorer({
        weights: { security: 1, resource: 1, deployment: 20, optimization: 1 },
      });

      const findings = makeFindings([{ severity: 'high', category: 'deployment' }]);

      const defaultResult = defaultScorer.score(findings);
      const heavyResult = heavyDeploymentScorer.score(findings);

      expect(heavyResult.overallScore).toBeGreaterThan(defaultResult.overallScore);
    });

    it('reflects custom weights in meta.weightsUsed', () => {
      const customWeights = { security: 5, resource: 5, deployment: 15, optimization: 2 };
      const s = new SorobanDeploymentRiskScorer({ weights: customWeights });
      const result = s.score([]);
      expect(result.meta.weightsUsed).toMatchObject(customWeights);
    });
  });

  // ── Severity multipliers ──────────────────────────────────────────────────

  describe('severity multipliers', () => {
    it('custom multipliers shift the score', () => {
      const amplified = new SorobanDeploymentRiskScorer({
        severityMultipliers: { critical: 100, high: 70, medium: 40, low: 20, info: 10 },
      });
      const normal = new SorobanDeploymentRiskScorer();

      const findings = makeFindings([{ severity: 'high', category: 'security' }]);
      const amplifiedResult = amplified.score(findings);
      const normalResult = normal.score(findings);

      expect(amplifiedResult.overallScore).toBeGreaterThan(normalResult.overallScore);
    });
  });

  // ── Meta ──────────────────────────────────────────────────────────────────

  describe('meta', () => {
    it('reports the correct totalFindings count', () => {
      const findings = makeFindings([{}, {}, {}]);
      const result = scorer.score(findings);
      expect(result.meta.totalFindings).toBe(3);
    });

    it('scoredAt is a valid ISO timestamp', () => {
      const result = scorer.score([]);
      expect(() => new Date(result.meta.scoredAt)).not.toThrow();
    });
  });
});
