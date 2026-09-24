import { detectRedundantEvents, RedundantEventRule } from '../redundant-event.rule';

describe('Soroban Redundant Event Rule (Issue #914)', () => {
  const rule = new RedundantEventRule();

  it('reports duplicate emission via rule evaluation', () => {
    const src = `
pub fn transfer(env: Env, from: Address, to: Address) {
    env.events().publish((symbol_short!("transfer"), from), to);
    env.events().publish((symbol_short!("transfer"), from), to);
}
`;
    const report = rule.evaluate(src);
    expect(report.findings.length).toBe(1);
    expect(report.findings[0].ruleId).toBe('soroban-redundant-event');
    expect(report.findings[0].suggestion).toMatch(/Remove|Hoist/);
  });

  it('reports clean summary when no duplicates', () => {
    const src = `
pub fn single(env: Env, from: Address, to: Address) {
    env.events().publish((symbol_short!("transfer"), from), to);
}
`;
    const report = detectRedundantEvents(src);
    expect(report.findings.length).toBe(0);
    expect(report.summary).toMatch(/No duplicate/);
  });
});
