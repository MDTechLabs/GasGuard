import {
  detectTopicInconsistencies,
  EventTopicConsistencyRule,
} from '../event-topic-consistency.rule';

describe('Soroban Event Topic Consistency Rule (Issue #916)', () => {
  const rule = new EventTopicConsistencyRule();

  it('reports inconsistency via rule evaluation', () => {
    const src = `
pub fn transfer(env: Env, from: Address, to: Address) {
    env.events().publish((symbol_short!("transfer"), from), to);
}
pub fn refund(env: Env, from: Address, to: Address) {
    env.events().publish((symbol_short!("Transfer"), from), to);
}
`;
    const report = rule.evaluate(src);
    expect(report.findings.length).toBeGreaterThanOrEqual(1);
    expect(report.findings[0].ruleId).toBe('soroban-event-topic-consistency');
    expect(report.findings[0].relatedFunctions).toContain('refund');
  });

  it('reports clean summary when topics are consistent', () => {
    const src = `
pub fn single(env: Env, from: Address) {
    env.events().publish((symbol_short!("transfer"), from), from);
}
`;
    const report = detectTopicInconsistencies(src);
    expect(report.findings.length).toBe(0);
    expect(report.summary).toMatch(/consistent/);
  });
});
