import { detectShortTtlValues, SorobanShortTtlRule } from '../short-ttl.rule';
import { detectTtlIssues, SorobanTtlRule } from '../ttl.rule';

const SHORT_TTL_CONTRACT = `
pub fn store(env: Env) {
    env.storage().persistent().set(&DataKey::A, &1u32);
    env.storage().persistent().extend_ttl(&DataKey::A, 1_000, 10_000);
}
`;

const MIXED_CONTRACT = `
pub fn write_config(env: Env) {
    env.storage().persistent().set(&DataKey::Config, &1u32);
}

pub fn short_bump(env: Env) {
    env.storage().persistent().set(&DataKey::Short, &1u32);
    env.storage().persistent().extend_ttl(&DataKey::Short, 1_000, 10_000);
}

pub fn inverted(env: Env) {
    env.storage().persistent().set(&DataKey::Inverted, &1u32);
    env.storage().persistent().extend_ttl(&DataKey::Inverted, 500_000, 400_000);
}
`;

describe('Soroban TTL rules (#885)', () => {
  describe('SorobanShortTtlRule', () => {
    it('reports short TTL values with the rule id and a suggestion', () => {
      const warnings = detectShortTtlValues(SHORT_TTL_CONTRACT);

      expect(warnings.length).toBeGreaterThanOrEqual(1);
      expect(warnings[0].ruleId).toBe('soroban-short-ttl');
      expect(warnings[0].severity).toBe('high');
      expect(warnings[0].key).toBe('DataKey::A');
      expect(warnings[0].line).toBeGreaterThan(0);
      expect(warnings[0].suggestion).toBeTruthy();
    });

    it('exposes the rule id through the rule class', () => {
      expect(new SorobanShortTtlRule().evaluate(SHORT_TTL_CONTRACT)[0].ruleId).toBe(
        SorobanShortTtlRule.RULE_ID,
      );
    });

    it('is clean for a well-sized extension', () => {
      const warnings = detectShortTtlValues(`
pub fn healthy(env: Env) {
    env.storage().persistent().extend_ttl(&DataKey::A, 17_280, 518_400);
}
`);
      expect(warnings).toHaveLength(0);
    });
  });

  describe('SorobanTtlRule', () => {
    it('surfaces every finding kind from the aggregate analyzer', () => {
      const warnings = detectTtlIssues(MIXED_CONTRACT);
      const kinds = new Set(warnings.map((warning) => warning.kind));

      expect(kinds.has('missing_extension')).toBe(true);
      expect(kinds.has('short_extend_ttl')).toBe(true);
      expect(kinds.has('invalid_extension_range')).toBe(true);
      expect(warnings.every((warning) => warning.suggestion.length > 0)).toBe(true);
    });

    it('returns the full analysis through getFullAnalysis', () => {
      const analysis = new SorobanTtlRule().getFullAnalysis(MIXED_CONTRACT);

      expect(analysis.operations.length).toBeGreaterThan(0);
      expect(analysis.metrics.totalOperations).toBe(analysis.operations.length);
      expect(analysis.summary).toMatch(/TTL/);
    });

    it('exposes the aggregate rule id', () => {
      expect(SorobanTtlRule.RULE_ID).toBe('soroban-ttl-analyzer');
      expect(new SorobanTtlRule().analyze(MIXED_CONTRACT).length).toBeGreaterThanOrEqual(3);
    });
  });
});
