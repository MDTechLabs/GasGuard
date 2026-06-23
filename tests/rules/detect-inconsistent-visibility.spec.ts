import { detectInconsistentVisibility } from '../../rules/stellar/security/visibility/detect-inconsistent-visibility';
import { FixtureLoader } from '../../libs/testing/src/fixture-loader';

describe('detectInconsistentVisibility', () => {
  describe('underscore-prefixed names', () => {
    it('flags pub fn that starts with an underscore', () => {
      const code = `
        #[contractimpl]
        impl Contract {
            pub fn _do_thing(env: Env) -> u32 { let _ = env; 1 }
            pub fn normal_entry(env: Env) -> u32 { let _ = env; 2 }
        }
      `;
      const result = detectInconsistentVisibility(code);
      expect(result.detected).toBe(true);
      expect(result.violations.map((v) => v.functionName)).toContain('_do_thing');
      expect(result.violations[0].kind).toBe('underscore-name');
    });

    it('does not flag a non-prefixed underscore helper that is just a normal function', () => {
      const code = `
        #[contractimpl]
        impl Contract {
            pub fn do_thing(env: Env) -> u32 { let _ = env; 1 }
        }
      `;
      const result = detectInconsistentVisibility(code);
      expect(result.detected).toBe(false);
    });
  });

  describe('helper-name patterns', () => {
    it('flags pub fn named helper_*', () => {
      const code = `
        #[contractimpl]
        impl Contract {
            pub fn helper_compute(env: Env) -> u32 { let _ = env; 0 }
        }
      `;
      const result = detectInconsistentVisibility(code);
      expect(result.detected).toBe(true);
      expect(result.violations[0].functionName).toBe('helper_compute');
    });

    it('flags pub fn named internal_*', () => {
      const code = `
        #[contractimpl]
        impl Contract {
            pub fn internal_reset(env: Env) { let _ = env; }
        }
      `;
      const result = detectInconsistentVisibility(code);
      expect(result.detected).toBe(true);
      expect(result.violations[0].functionName).toBe('internal_reset');
    });

    it('flags pub fn named *_inner', () => {
      const code = `
        #[contractimpl]
        impl Contract {
            pub fn state_inner(env: Env) -> u32 { let _ = env; 0 }
        }
      `;
      const result = detectInconsistentVisibility(code);
      expect(result.detected).toBe(true);
      expect(result.violations[0].functionName).toBe('state_inner');
    });

    it('flags pub fn whose name contains private_', () => {
      const code = `
        #[contractimpl]
        impl Contract {
            pub fn private_seed(env: Env) -> u32 { let _ = env; 7 }
        }
      `;
      const result = detectInconsistentVisibility(code);
      expect(result.detected).toBe(true);
      expect(result.violations[0].kind).toBe('helper-name');
    });

    it('flags pub fn whose name contains priv_', () => {
      const code = `
        #[contractimpl]
        impl Contract {
            pub fn priv_balance(env: Env, a: Address) -> i128 { let _ = (env, a); 0 }
        }
      `;
      const result = detectInconsistentVisibility(code);
      expect(result.detected).toBe(true);
      expect(result.violations[0].kind).toBe('helper-name');
    });
  });

  describe('helper without Env parameter', () => {
    it('flags a helper-named function that does not take Env', () => {
      const code = `
        #[contractimpl]
        impl Contract {
            pub fn helper_sum(a: u32, b: u32) -> u32 { a + b }
        }
      `;
      const result = detectInconsistentVisibility(code);
      expect(result.detected).toBe(true);
      expect(result.violations[0].functionName).toBe('helper_sum');
      expect(result.violations[0].kind).toBe('helper-no-env');
    });

    it('flags a helper-named function with Env as helper-name (not no-env)', () => {
      const code = `
        #[contractimpl]
        impl Contract {
            pub fn helper_sum(env: Env, a: u32, b: u32) -> u32 { let _ = env; a + b }
        }
      `;
      const result = detectInconsistentVisibility(code);
      expect(result.detected).toBe(true);
      expect(result.violations[0].functionName).toBe('helper_sum');
      expect(result.violations[0].kind).toBe('helper-name');
    });
  });

  describe('safe cases', () => {
    it('does not flag pub(crate) fn helpers (Soroban ignores those)', () => {
      const code = `
        #[contractimpl]
        impl Contract {
            pub(crate) fn helper(env: Env) -> u32 { let _ = env; 0 }
            pub fn entry(env: Env) -> u32 { let _ = env; 1 }
        }
      `;
      const result = detectInconsistentVisibility(code);
      expect(result.detected).toBe(false);
    });

    it('does not flag pub(super) fn', () => {
      const code = `
        #[contractimpl]
        impl Contract {
            pub(super) fn internal_helper(env: Env) -> u32 { let _ = env; 0 }
            pub fn entry(env: Env) -> u32 { let _ = env; 1 }
        }
      `;
      const result = detectInconsistentVisibility(code);
      expect(result.detected).toBe(false);
    });

    it('does not flag normal pub fn with clear naming and Env parameter', () => {
      const code = `
        #[contractimpl]
        impl Contract {
            pub fn transfer(env: Env, from: Address, to: Address) { let _ = (env, from, to); }
            pub fn balance(env: Env, owner: Address) -> i128 { let _ = (env, owner); 0 }
        }
      `;
      const result = detectInconsistentVisibility(code);
      expect(result.detected).toBe(false);
      expect(result.violations).toHaveLength(0);
    });

    it('returns detected=false when there is no #[contractimpl] block', () => {
      const code = `
        impl NotAContract {
            pub fn _private_helper() { }
        }
      `;
      const result = detectInconsistentVisibility(code);
      expect(result.detected).toBe(false);
    });

    it('handles nested impl blocks (tracks only contractimpl ones)', () => {
      const code = `
        #[contractimpl]
        impl Outer {
            pub fn entry(env: Env) -> u32 { let _ = env; 1 }
            mod inner {
                pub fn _private_thing() { }
            }
        }
      `;
      const result = detectInconsistentVisibility(code);
      expect(result.detected).toBe(false);
      expect(result.implementationsScanned).toBe(1);
    });
  });

  describe('reports state', () => {
    it('reports the number of functions scanned and impl blocks', () => {
      const code = `
        #[contractimpl]
        impl C1 {
            pub fn a(env: Env) -> u32 { let _ = env; 1 }
            pub fn b(env: Env) -> u32 { let _ = env; 2 }
        }
        #[contractimpl]
        impl C2 {
            pub fn c(env: Env) -> u32 { let _ = env; 3 }
        }
      `;
      const result = detectInconsistentVisibility(code);
      expect(result.implementationsScanned).toBe(2);
      expect(result.functionsScanned).toBe(3);
    });

    it('includes a useful message and suggestion when violations are found', () => {
      const code = `
        #[contractimpl]
        impl C {
            pub fn _helper(env: Env) -> u32 { let _ = env; 0 }
        }
      `;
      const result = detectInconsistentVisibility(code);
      expect(result.detected).toBe(true);
      expect(result.message).toMatch(/_helper/);
      expect(result.suggestion).toMatch(/pub\(crate\)/);
    });
  });

  describe('multiple violations', () => {
    it('reports every violating function', () => {
      const code = `
        #[contractimpl]
        impl Contract {
            pub fn _alpha(env: Env) -> u32 { let _ = env; 1 }
            pub fn _beta(env: Env) -> u32 { let _ = env; 2 }
            pub fn helper_gamma(env: Env) -> u32 { let _ = env; 3 }
            pub fn entry(env: Env) -> u32 { let _ = env; 4 }
        }
      `;
      const result = detectInconsistentVisibility(code);
      expect(result.detected).toBe(true);
      const names = result.violations.map((v) => v.functionName).sort();
      expect(names).toEqual(['_alpha', '_beta', 'helper_gamma']);
    });
  });

  describe('fixture validation', () => {
    it('fixture matches expected structure', () => {
      const fixture = FixtureLoader.loadFixture(
        './tests/rules/fixtures/stellar-inconsistent-visibility.json',
      );
      expect(fixture.id).toBe('stellar-inconsistent-visibility-1');
      expect(fixture.expectedFindings).toHaveLength(4);
      expect(fixture.metadata?.category).toBe('security');
    });

    it('detector agrees with fixture violations', () => {
      const fixture = FixtureLoader.loadFixture(
        './tests/rules/fixtures/stellar-inconsistent-visibility.json',
      );
      const result = detectInconsistentVisibility(fixture.input);
      expect(result.detected).toBe(true);

      const fnNames = result.violations.map((v) => v.functionName).sort();
      expect(fnNames).toContain('_internal_seed');
      expect(fnNames).toContain('helper_compute_total');
      expect(fnNames).toContain('state_inner');
      expect(fnNames).toContain('priv_lock');
      // The safe entry point must not be flagged.
      expect(fnNames).not.toContain('transfer');
      expect(fnNames).not.toContain('balance_of');
    });
  });
});
