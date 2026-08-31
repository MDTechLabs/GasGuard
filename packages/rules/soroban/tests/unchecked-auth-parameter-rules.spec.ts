import {
  detectUncheckedAuthParameters,
  UncheckedAuthParameterRule,
} from '../auth/unchecked-auth-parameter.rule';
import {
  analyzeUncheckedAuthParameters,
  UncheckedAuthParameterAnalyzer,
} from '../src/authorization/unchecked-auth-parameter-analyzer';

describe('Soroban Unchecked Auth Parameter Rule (Issue #897)', () => {
  const rule = new UncheckedAuthParameterRule();

  it('reports unchecked parameter via rule evaluation', () => {
    const src = `
fn transfer_funds(env: Env, from: Address, to: Address, amount: i128) {
    let client = token::Client::new(&env, &token);
    client.transfer(&from, &to, &amount);
}
`;
    const report = rule.evaluate(src);
    expect(report.findings.length).toBe(1);
    expect(report.findings[0].ruleId).toBe('soroban-unchecked-auth-parameter');
    expect(report.findings[0].rule).toBe('A4-unchecked-auth-param');
    expect(report.findings[0].parameterName).toBe('from');
    expect(report.findings[0].severity).toBe('high');
    expect(report.summary).toMatch(/1 unchecked/i);
  });

  it('reports clean report summary when all auth parameters are valid', () => {
    const src = `
fn transfer_funds(env: Env, from: Address, to: Address, amount: i128) {
    from.require_auth();
    let client = token::Client::new(&env, &token);
    client.transfer(&from, &to, &amount);
}
`;
    const report = detectUncheckedAuthParameters(src);
    expect(report.findings.length).toBe(0);
    expect(report.summary).toMatch(/properly validated/i);
  });

  it('re-exported analyzer in authorization module functions identically', () => {
    const src = `
fn update_owner(env: Env, new_owner: Address, current_owner: Address) {
    env.storage().instance().set(&DataKey::Owner, &new_owner);
}
`;
    const findings = new UncheckedAuthParameterAnalyzer().analyze(src);
    expect(findings.length).toBe(1);
    expect(findings[0].parameterName).toBe('current_owner');
  });
});
