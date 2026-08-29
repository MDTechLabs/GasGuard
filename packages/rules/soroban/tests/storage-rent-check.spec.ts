import { SorobanStorageRentCheckRule } from '../src/storage-rent-check';

describe('SorobanStorageRentCheckRule', () => {
  let rule: SorobanStorageRentCheckRule;

  beforeEach(() => {
    rule = new SorobanStorageRentCheckRule();
  });

  it('should flag persistent storage usage for ephemeral keys like nonce or counter', () => {
    const code = `
      pub fn increment_nonce(env: Env) {
        let key = Symbol::new(&env, "user_nonce");
        let count: u32 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(count + 1));
      }
    `;

    const warnings = rule.analyze(code);
    expect(warnings.length).toBeGreaterThan(0);
    const persistentWarning = warnings.find((w) => w.storageType === 'persistent');
    expect(persistentWarning).toBeDefined();
    expect(persistentWarning?.key).toBe('user_nonce');
    expect(persistentWarning?.suggestion).toContain('temporary()');
    expect(persistentWarning?.estimatedRentSavings).toBeDefined();
  });

  it('should flag missing extend_ttl call when instance storage is accessed', () => {
    const code = `
      pub fn set_admin(env: Env, admin: Address) {
        env.storage().instance().set(&Symbol::new(&env, "admin"), &admin);
      }
    `;

    const warnings = rule.analyze(code);
    const instanceWarning = warnings.find((w) => w.storageType === 'instance');
    expect(instanceWarning).toBeDefined();
    expect(instanceWarning?.message).toContain('without explicit extend_ttl call');
  });

  it('should not flag instance storage if extend_ttl is properly invoked', () => {
    const code = `
      pub fn set_admin(env: Env, admin: Address) {
        env.storage().instance().set(&Symbol::new(&env, "admin"), &admin);
        env.storage().instance().extend_ttl(100, 1000);
      }
    `;

    const warnings = rule.analyze(code);
    const instanceWarning = warnings.find((w) => w.storageType === 'instance');
    expect(instanceWarning).toBeUndefined();
  });
});
