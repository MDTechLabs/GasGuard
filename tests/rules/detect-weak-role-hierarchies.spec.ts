import { detectWeakRoleHierarchies } from '../../rules/stellar/access-control/detect-weak-role-hierarchies';
import { FixtureLoader } from '../../libs/testing/src/fixture-loader';

describe('detectWeakRoleHierarchies', () => {
  describe('detection cases', () => {
    it('flags a grant_role function with only require_auth', () => {
      const code = `
        pub fn grant_role(env: Env, caller: Address, target: Address, role: Role) {
          caller.require_auth();
          env.storage().instance().set(&target, &role);
        }
      `;
      const result = detectWeakRoleHierarchies(code);
      expect(result.detected).toBe(true);
      expect(result.weakRoles).toContain('grant_role');
      expect(result.message).toMatch(/grant_role/);
    });

    it('flags add_admin with no auth guard at all', () => {
      const code = `
        pub fn add_admin(env: Env, new_admin: Address) {
          env.storage().instance().set(&new_admin, &Role::Admin);
        }
      `;
      const result = detectWeakRoleHierarchies(code);
      expect(result.detected).toBe(true);
      expect(result.weakRoles).toContain('add_admin');
    });

    it('flags multiple weak role functions', () => {
      const code = `
        pub fn grant_role(env: Env, caller: Address, target: Address, role: Role) {
          caller.require_auth();
          env.storage().instance().set(&target, &role);
        }
        pub fn set_role(env: Env, caller: Address, target: Address, role: Role) {
          caller.require_auth();
          env.storage().instance().set(&target, &role);
        }
      `;
      const result = detectWeakRoleHierarchies(code);
      expect(result.detected).toBe(true);
      expect(result.weakRoles).toHaveLength(2);
      expect(result.weakRoles).toContain('grant_role');
      expect(result.weakRoles).toContain('set_role');
    });
  });

  describe('safe cases', () => {
    it('does not flag a function guarded with admin.require_auth', () => {
      const code = `
        pub fn grant_role(env: Env, admin: Address, target: Address, role: Role) {
          admin.require_auth();
          assert_admin(&env, &admin);
          env.storage().instance().set(&target, &role);
        }
      `;
      const result = detectWeakRoleHierarchies(code);
      expect(result.detected).toBe(false);
      expect(result.weakRoles).toHaveLength(0);
    });

    it('does not flag when no role-assignment functions exist', () => {
      const code = `
        pub fn get_balance(env: Env, address: Address) -> i128 {
          env.storage().instance().get(&address).unwrap_or(0)
        }
      `;
      const result = detectWeakRoleHierarchies(code);
      expect(result.detected).toBe(false);
    });

    it('does not flag a function guarded with only_admin', () => {
      const code = `
        pub fn add_admin(env: Env, caller: Address, new_admin: Address) {
          only_admin(&env, &caller);
          env.storage().instance().set(&new_admin, &Role::Admin);
        }
      `;
      const result = detectWeakRoleHierarchies(code);
      expect(result.detected).toBe(false);
    });
  });

  describe('fixture validation', () => {
    it('fixture matches expected structure', () => {
      const fixture = FixtureLoader.loadFixture(
        './tests/rules/fixtures/stellar-weak-role-hierarchy.json'
      );
      expect(fixture.id).toBe('stellar-weak-role-hierarchy-1');
      expect(fixture.expectedFindings).toHaveLength(2);
      expect(fixture.metadata?.category).toBe('access-control');
    });

    it('detector agrees with fixture violations', () => {
      const fixture = FixtureLoader.loadFixture(
        './tests/rules/fixtures/stellar-weak-role-hierarchy.json'
      );
      const result = detectWeakRoleHierarchies(fixture.input);
      expect(result.detected).toBe(true);
      expect(result.weakRoles).toContain('grant_role');
      expect(result.weakRoles).toContain('add_admin');
      expect(result.weakRoles).not.toContain('safe_promote');
    });
  });
});
