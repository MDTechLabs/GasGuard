import {
  computeConfidence,
  defaultFactors,
  levelFromScore,
  scoreFinding,
  scoreFindings,
} from '../confidence-scorer';

describe('ConfidenceScorer (#789)', () => {
  it('computes a score within [0,1]', () => {
    const score = computeConfidence({ ruleReliability: 0.8, contextSafety: 0.7, evidenceStrength: 0.6 });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('negatively weights weak factors', () => {
    const strong = computeConfidence({ ruleReliability: 0.9, contextSafety: 0.9, evidenceStrength: 0.9 });
    const weak = computeConfidence({ ruleReliability: 0.1, contextSafety: 0.9, evidenceStrength: 0.9 });
    expect(weak).toBeLessThan(strong);
  });

  it('maps scores to categorical levels', () => {
    expect(levelFromScore(0.85)).toBe('high');
    expect(levelFromScore(0.5)).toBe('medium');
    expect(levelFromScore(0.2)).toBe('low');
  });

  it('looks up default rule reliability', () => {
    const factors = defaultFactors('soroban-call-frequency');
    expect(factors.ruleReliability).toBe(0.8);
  });

  it('falls back to a default reliability for unknown rules', () => {
    const factors = defaultFactors('unknown-rule');
    expect(factors.ruleReliability).toBe(0.55);
  });

  it('produces scored findings with rationale and level', () => {
    const finding = scoreFinding(
      'soroban-unused-state-variables',
      'Remove unused variable',
      defaultFactors('soroban-unused-state-variables'),
      12,
    );
    expect(finding.confidence).toBeGreaterThanOrEqual(0.7);
    expect(finding.level).toBe('high');
    expect(finding.rationale.length).toBeGreaterThan(0);
    expect(finding.line).toBe(12);
  });

  it('batch-scores findings', () => {
    const scored = scoreFindings([
      { ruleId: 'soroban-call-frequency', recommendation: 'cache calls', line: 3 },
      { ruleId: 'soroban-unbounded-loop', recommendation: 'bound loop' },
    ]);
    expect(scored).toHaveLength(2);
    for (const s of scored) {
      expect(s.confidence).toBeGreaterThanOrEqual(0);
      expect(s.level).toBeDefined();
    }
  });
});