import { detectOversizedPayloads, OversizedPayloadRule } from '../oversized-payload.rule';

describe('Soroban Oversized Payload Rule (Issue #915)', () => {
  const rule = new OversizedPayloadRule();

  it('reports oversized payload via rule evaluation', () => {
    const src = `
pub fn register(env: Env, user: Address) {
    env.events().publish((symbol_short!("register"), user), UserProfile { name, email, phone, address, age, balance });
}
`;
    const report = rule.evaluate(src);
    expect(report.findings.length).toBeGreaterThanOrEqual(1);
    expect(report.findings[0].ruleId).toBe('soroban-oversized-event-payload');
    expect(report.findings[0].suggestion).toMatch(/compact|smaller/i);
  });

  it('reports clean summary when payloads are small', () => {
    const src = `
pub fn ping(env: Env) {
    env.events().publish((symbol_short!("ping"),), 1);
}
`;
    const report = detectOversizedPayloads(src);
    expect(report.findings.length).toBe(0);
    expect(report.summary).toMatch(/No oversized/);
  });
});
