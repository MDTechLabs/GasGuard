import {
  detectAuthorizationTreeIssues,
  AuthorizationTreeRule,
} from '../authorization-tree.rule';

describe('Soroban Authorization Tree Rule (Issue #917)', () => {
  const rule = new AuthorizationTreeRule();

  it('reports entrypoint without auth via rule evaluation', () => {
    const src = `
pub fn view_balance(env: Env, account: Address) -> i128 {
    storage::get(&account)
}
`;
    const report = rule.evaluate(src);
    expect(report.findings.length).toBe(1);
    expect(report.findings[0].ruleId).toBe('soroban-authorization-tree');
    expect(report.findings[0].details.kind).toBe('missing_auth');
  });

  it('reports clean summary when auth is present', () => {
    const src = `
pub fn transfer(env: Env, from: Address, to: Address) {
    from.require_auth();
}
`;
    const report = detectAuthorizationTreeIssues(src);
    expect(report.findings.length).toBe(0);
    expect(report.summary).toMatch(/all enforce/i);
  });

  it('flags helper-only authorization edges', () => {
    const src = `
pub fn check_owner(env: Env, owner: Address) {
    owner.require_auth();
}
pub fn transfer(env: Env, owner: Address, to: Address) {
    check_owner(&env, &owner);
}
`;
    const report = detectAuthorizationTreeIssues(src);
    expect(report.findings.some((f) => f.details.kind === 'helper_only_auth')).toBe(true);
  });
});
