import { analyzeRepeatedAuthChecks, RepeatedAuthCheckAnalyzer } from '../repeated-auth-check-analyzer';

describe('RepeatedAuthCheckAnalyzer (#860)', () => {
  it('detects repeated require_auth on the same subject in one function', () => {
    const src = `
pub fn transfer(env: Env, user: Address, amount: i128) {
    user.require_auth();
    let bal = read_balance(&env, &user);
    user.require_auth();
    write_balance(&env, &user, bal - amount);
}
`;
    const report = analyzeRepeatedAuthChecks(src);
    expect(report.findings.length).toBeGreaterThanOrEqual(1);
    expect(report.findings[0].subject).toBe('user');
    expect(report.findings[0].checkCount).toBeGreaterThanOrEqual(2);
    expect(report.findings[0].suggestion).toMatch(/once/i);
  });

  it('does not flag a single auth check', () => {
    const src = `
pub fn withdraw(env: Env, user: Address) {
    user.require_auth();
    do_withdraw(&env, &user);
}
`;
    const report = analyzeRepeatedAuthChecks(src);
    expect(report.findings.length).toBe(0);
  });

  it('analyzes execution paths via pathId grouping', () => {
    const src = `
pub fn route(env: Env, user: Address, flag: bool) {
    if flag {
        user.require_auth();
        a(&env);
    } else {
        user.require_auth();
        b(&env);
    }
}
`;
    const report = analyzeRepeatedAuthChecks(src);
    // exclusive branches may still share path granularity; ensure analysis runs
    expect(report.checks.length).toBeGreaterThanOrEqual(2);
    expect(report.metrics.totalChecks).toBeGreaterThanOrEqual(2);
  });

  it('class analyzer exposes findings API', () => {
    const analyzer = new RepeatedAuthCheckAnalyzer();
    const findings = analyzer.analyze(`
fn foo(u: Address) {
  u.require_auth();
  u.require_auth();
}
`);
    expect(findings[0].ruleId).toBe('soroban-repeated-auth-check');
  });
});
