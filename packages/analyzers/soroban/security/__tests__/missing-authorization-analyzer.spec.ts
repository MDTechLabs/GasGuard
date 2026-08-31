import { analyzeMissingAuthorization, MissingAuthorizationAnalyzer } from '../missing-authorization-analyzer';

describe('MissingAuthorizationAnalyzer (#859)', () => {
  it('detects sensitive transfer without require_auth', () => {
    const src = `
pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
    env.storage().persistent().set(&from, &amount);
}
`;
    const findings = analyzeMissingAuthorization(src);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0].functionName).toBe('transfer');
    expect(findings[0].rule).toBe('M1-missing-auth');
    expect(findings[0].location.functionName).toBe('transfer');
  });

  it('does not flag functions that call require_auth', () => {
    const src = `
pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
    from.require_auth();
    env.storage().persistent().set(&DataKey::Bal(from.clone()), &amount);
}
`;
    const findings = analyzeMissingAuthorization(src);
    expect(findings.find((f) => f.functionName === 'transfer')).toBeUndefined();
  });

  it('excludes intentionally public getters', () => {
    const src = `
pub fn get_balance(env: Env, user: Address) -> i128 {
    env.storage().persistent().get(&user).unwrap_or(0)
}
pub fn view_config(env: Env) -> u32 { 1 }
`;
    const findings = analyzeMissingAuthorization(src);
    expect(findings.length).toBe(0);
  });

  it('identifies admin/pause style mutators as sensitive', () => {
    const src = `
pub fn pause(env: Env) {
    env.storage().instance().set(&DataKey::Paused, &true);
}
`;
    const findings = analyzeMissingAuthorization(src);
    expect(findings.some((f) => f.functionName === 'pause')).toBe(true);
  });

  it('class analyzer returns findings', () => {
    const a = new MissingAuthorizationAnalyzer();
    expect(a.analyze(`fn mint(e: Env) { e.storage().persistent().set(&1, &2); }`).length).toBeGreaterThan(0);
  });
});
