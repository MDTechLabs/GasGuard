import { detectInitializationRisks } from '../detect-unprotected-initializers';

describe('detectInitializationRisks', () => {
  it('detects missing constructor', () => {
    const code = `
      fn transfer(from: Address, to: Address, amount: i128) {
        from.require_auth();
      }
    `;
    const risks = detectInitializationRisks(code);
    expect(risks.some(r => r.type === 'missing-constructor')).toBe(true);
  });

  it('passes when constructor exists', () => {
    const code = `
      fn new(env: Env, admin: Address) {
        admin.require_auth();
        env.storage().instance().set(&INITIALIZED, &true);
      }
    `;
    const risks = detectInitializationRisks(code);
    expect(risks.filter(r => r.type === 'missing-constructor')).toHaveLength(0);
  });

  it('detects re-initialization vulnerability', () => {
    const code = `
      fn initialize(env: Env, admin: Address) {
        admin.require_auth();
      }
    `;
    const risks = detectInitializationRisks(code);
    expect(risks.some(r => r.type === 'reinitialization-vulnerability')).toBe(true);
  });
});
