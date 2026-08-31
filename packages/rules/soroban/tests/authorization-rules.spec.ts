import { SorobanAuthorizationAnalyzer } from '../src/authorization/authorization-analyzer';
import { analyzeMissingAuthorization } from '../src/authorization/missing-authorization-analyzer';

describe('Soroban authorization rules (#859 / #860)', () => {
  describe('repeated checks (cost analyzer)', () => {
    it('flags repeated require_auth', () => {
      const src = `
fn settle(env: Env, a: Address) {
    a.require_auth();
    work(&env);
    a.require_auth();
}
`;
      const findings = new SorobanAuthorizationAnalyzer().analyze(src);
      expect(findings.some((f) => f.rule === 'A1-repeated-auth')).toBe(true);
      expect(findings.find((f) => f.rule === 'A1-repeated-auth')?.suggestion).toMatch(/single/i);
    });
  });

  describe('missing authorization', () => {
    it('reports state-changing fn without auth', () => {
      const findings = analyzeMissingAuthorization(`
fn update_admin(env: Env, new_admin: Address) {
    env.storage().instance().set(&DataKey::Admin, &new_admin);
}
`);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0].severity).toBe('high');
    });

    it('skips public read functions', () => {
      const findings = analyzeMissingAuthorization(`
fn get_admin(env: Env) -> Address {
    env.storage().instance().get(&DataKey::Admin).unwrap()
}
`);
      expect(findings.length).toBe(0);
    });
  });
});
