import {
  SorobanSuggestionEngine,
  getSorobanSuggestionForFinding,
} from '../index';

describe('SorobanSuggestionEngine', () => {
  it('maps a finding to an actionable recommendation with rationale and estimated impact', () => {
    const result = getSorobanSuggestionForFinding({
      ruleId: 'soroban-call-frequency',
      severity: 'high',
      message: "Function 'transfer' invokes helper 'is_authorized' 9 times in a hot path.",
      suggestion: "Consider inlining, memoizing, or batching repeated calls to 'is_authorized'.",
    });

    expect(result.ruleId).toBe('soroban-call-frequency');
    expect(result.recommendation).toContain('cache');
    expect(result.rationale).toContain('hot path');
    expect(result.expectedImpact).toMatch(/20%|30%|40%/);
  });

  it('accepts rule-specific suggestion templates for storage rent findings', () => {
    const engine = new SorobanSuggestionEngine();
    const suggestions = engine.suggest([
      {
        ruleId: 'soroban-storage-rent',
        severity: 'medium',
        message: 'Persistent storage is used for a short-lived nonce.',
      },
    ]);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].recommendation).toContain('temporary');
    expect(suggestions[0].expectedImpact).toContain('rent');
  });
});
