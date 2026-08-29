import { describe, expect, it } from '@jest/globals';
import { StellarSecurityProfile } from './security-profile';

describe('StellarSecurityProfile', () => {
  it('flags missing authorization as critical', () => {
    const source = `pub struct NoAuth;
pub fn transfer(env: Env, to: Address, amount: u64) {
    env.storage().set(to, amount);
}`;

    const profile = new StellarSecurityProfile(source, 'noauth.rs');
    const result = profile.run();

    const authCheck = result.checks.find(c => c.id === 'SEC-001');
    expect(authCheck).toBeDefined();
    expect(authCheck!.passed).toBe(false);
    expect(authCheck!.severity).toBe('critical');
    expect(result.criticalIssues.length).toBeGreaterThanOrEqual(1);
  });

  it('passes when authorization is present', () => {
    const source = `pub struct Secure;
pub fn transfer(env: Env, to: Address, amount: u64) {
    env.require_auth();
    env.storage().set(to, amount);
}`;

    const profile = new StellarSecurityProfile(source, 'secure.rs');
    const result = profile.run();

    const authCheck = result.checks.find(c => c.id === 'SEC-001');
    expect(authCheck!.passed).toBe(true);
  });

  it('detects excessive unwrap usage', () => {
    const source = `pub struct Risky;
pub fn process(env: Env) -> u64 {
    let a = env.storage().get(&"a".into()).unwrap();
    let b = env.storage().get(&"b".into()).unwrap();
    let c = env.storage().get(&"c".into()).unwrap();
    let d = env.storage().get(&"d".into()).unwrap();
    a + b + c + d
}`;

    const profile = new StellarSecurityProfile(source, 'risky.rs');
    const result = profile.run();

    const unwrapCheck = result.checks.find(c => c.id === 'SEC-005');
    expect(unwrapCheck!.passed).toBe(false);
  });

  it('calculates overall score', () => {
    const source = `pub struct Test;
pub fn safe_fn(env: Env) {
    env.require_auth();
}`;

    const profile = new StellarSecurityProfile(source, 'test.rs', { strictMode: false, failOnCritical: true, customChecks: [] });
    const result = profile.run();

    expect(result.passedCount).toBeGreaterThan(0);
    expect(result.overallScore).toBeGreaterThan(50);
  });
});
