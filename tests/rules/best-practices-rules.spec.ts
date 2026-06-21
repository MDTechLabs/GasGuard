import { detectUnsafeIntTypes } from '../../src/rules/best-practices/stellar/use-safe-int-types';
import { detectMutableStorageInView } from '../../src/rules/best-practices/stellar/use-immutable-storage';
import { detectUncheckedArithmetic } from '../../src/rules/best-practices/stellar/use-checked-arithmetic';
import { detectMissingResultType } from '../../src/rules/best-practices/stellar/use-result-types';
import { detectMissingInitialization } from '../../src/rules/best-practices/stellar/use-initialization-functions';
import { runBestPractices, validateBestPracticesConfig, BestPracticesConfigError, DEFAULT_BEST_PRACTICES_CONFIG } from '../../src/rules/best-practices';
import { FixtureLoader } from '../../libs/testing/src/fixture-loader';

describe('best-practices / use-safe-int-types', () => {
  it('flags i128 function parameters', () => {
    const code = `pub fn transfer(env: Env, from: Address, to: Address, value: i128) { }`;
    const result = detectUnsafeIntTypes(code);
    expect(result.detected).toBe(true);
    expect(result.overSized[0].type).toBe('i128');
    expect(result.overSized[0].suggested).toBe('i64');
  });

  it('flags u128 variables', () => {
    const code = `let fee: u128 = 100;`;
    const result = detectUnsafeIntTypes(code);
    expect(result.detected).toBe(true);
    expect(result.overSized[0].type).toBe('u128');
    expect(result.overSized[0].suggested).toBe('u64');
  });

  it('flags i128 return types', () => {
    const code = `pub fn get_value(env: Env) -> i128 { 0 }`;
    const result = detectUnsafeIntTypes(code);
    expect(result.detected).toBe(true);
    expect(result.overSized[0].type).toBe('i128');
  });

  it('does not flag amount/balance params', () => {
    const code = `pub fn transfer(env: Env, from: Address, to: Address, amount: i128) { }`;
    const result = detectUnsafeIntTypes(code);
    expect(result.detected).toBe(false);
  });

  it('does not flag code without i128/u128', () => {
    const code = `pub fn add(a: i64, b: i64) -> i64 { a + b }`;
    const result = detectUnsafeIntTypes(code);
    expect(result.detected).toBe(false);
  });
});

describe('best-practices / use-immutable-storage', () => {
  it('flags storage writes in get_ prefixed functions', () => {
    const code = `
      pub fn get_balance(env: Env, addr: Address) -> i128 {
        let bal = env.storage().instance().get(&addr).unwrap_or(0);
        env.storage().instance().set(&"last", &addr);
        bal
      }
    `;
    const result = detectMutableStorageInView(code);
    expect(result.detected).toBe(true);
    expect(result.violations[0].functionName).toBe('get_balance');
    expect(result.violations[0].access).toBe('set');
  });

  it('does not flag pure read functions', () => {
    const code = `
      pub fn get_balance(env: Env, addr: Address) -> i128 {
        env.storage().instance().get(&addr).unwrap_or(0)
      }
    `;
    const result = detectMutableStorageInView(code);
    expect(result.detected).toBe(false);
  });

  it('does not flag explicit set_ functions', () => {
    const code = `
      pub fn set_balance(env: Env, addr: Address, val: i128) {
        env.storage().instance().set(&addr, &val);
      }
    `;
    const result = detectMutableStorageInView(code);
    expect(result.detected).toBe(false);
  });
});

describe('best-practices / use-checked-arithmetic', () => {
  it('flags unchecked addition', () => {
    const code = `let result = a + b;`;
    const result = detectUncheckedArithmetic(code);
    expect(result.detected).toBe(true);
    expect(result.violations[0].operator).toBe('+');
  });

  it('flags unchecked division', () => {
    const code = `let result = a / b;`;
    const result = detectUncheckedArithmetic(code);
    expect(result.detected).toBe(true);
    expect(result.violations[0].operator).toBe('/');
  });

  it('does not flag code with checked arithmetic', () => {
    const code = `let result = a.checked_add(b).unwrap_or(0);`;
    const result = detectUncheckedArithmetic(code);
    expect(result.detected).toBe(false);
  });

  it('does not flag simple loop counters', () => {
    const code = `for (let i = 0; i < 10; i++) { }`;
    const result = detectUncheckedArithmetic(code);
    expect(result.detected).toBe(false);
  });

  it('does not flag code without arithmetic', () => {
    const code = `let x = env.storage().instance().get(&key);`;
    const result = detectUncheckedArithmetic(code);
    expect(result.detected).toBe(false);
  });
});

describe('best-practices / use-result-types', () => {
  it('flags unwrap without Result return', () => {
    const code = `
      pub fn get_val(env: Env, key: Address) -> i128 {
        env.storage().instance().get(&key).unwrap()
      }
    `;
    const result = detectMissingResultType(code);
    expect(result.detected).toBe(true);
    expect(result.violations[0].functionName).toBe('get_val');
  });

  it('does not flag when Result is returned', () => {
    const code = `
      pub fn get_val(env: Env, key: Address) -> Result<i128, Error> {
        env.storage().instance().get(&key).ok_or(Error::NotFound)
      }
    `;
    const result = detectMissingResultType(code);
    expect(result.detected).toBe(false);
  });

  it('does not flag code without fallible calls', () => {
    const code = `pub fn add(a: i64, b: i64) -> i64 { a + b }`;
    const result = detectMissingResultType(code);
    expect(result.detected).toBe(false);
  });
});

describe('best-practices / use-initialization-functions', () => {
  it('flags contract with storage init but no constructor', () => {
    const code = `
      impl MyContract {
        pub fn set_admin(env: Env, admin: Address) {
          env.storage().instance().set(&"admin", &admin);
        }
      }
    `;
    const result = detectMissingInitialization(code);
    expect(result.detected).toBe(true);
    expect(result.violations[0].contractName).toBe('MyContract');
  });

  it('does not flag contract with __constructor', () => {
    const code = `
      impl MyContract {
        pub fn __constructor(env: Env, admin: Address) {
          env.storage().instance().set(&"admin", &admin);
        }
      }
    `;
    const result = detectMissingInitialization(code);
    expect(result.detected).toBe(false);
  });

  it('does not flag contract with no storage init', () => {
    const code = `
      impl MyContract {
        pub fn get(env: Env) -> i32 { 0 }
      }
    `;
    const result = detectMissingInitialization(code);
    expect(result.detected).toBe(false);
  });
});

describe('best-practices / runBestPractices (pack integration)', () => {
  it('returns findings for code with multiple issues', () => {
    const code = `
      impl BadContract {
        pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
          let fee: u128 = 100;
          let total = amount + fee;
          env.storage().instance().get(&from).unwrap();
        }
      }
    `;
    const report = runBestPractices(code);
    expect(report.summary.total).toBeGreaterThan(0);
    expect(report.summary.detected).toBeGreaterThanOrEqual(2);
    expect(report.summary.categories['best-practices']).toBeGreaterThanOrEqual(2);
  });

  it('respects rule config via enabled flag', () => {
    const code = `let fee: u128 = 100;`;
    const report = runBestPractices(code, {
      rules: {
        'use-safe-int-types': { enabled: false, severity: 'medium' },
      },
    });
    const safeInt = report.findings.find(f => f.ruleId === 'use-safe-int-types');
    expect(safeInt).toBeDefined();
    expect(safeInt!.detected).toBe(false);
    const totalDetected = report.findings.filter(f => f.detected).length;
    expect(totalDetected).toBeGreaterThanOrEqual(0);
  });

  it('returns summary with categories and severities', () => {
    const code = `let x: u128 = 1; let y = x + 2;`;
    const report = runBestPractices(code);
    expect(report.summary).toBeDefined();
    expect(report.summary.total).toBeGreaterThan(0);
    expect(typeof report.summary.categories['best-practices']).toBe('number');
    expect(typeof report.summary.severities['medium']).toBe('number');
  });
});

describe('best-practices / config validation', () => {
  it('accepts valid config', () => {
    const config = validateBestPracticesConfig({
      rules: {
        'use-safe-int-types': { enabled: true, severity: 'high' },
      },
    });
    expect(config.rules['use-safe-int-types'].enabled).toBe(true);
    expect(config.rules['use-safe-int-types'].severity).toBe('high');
  });

  it('accepts default config', () => {
    expect(DEFAULT_BEST_PRACTICES_CONFIG.rules['use-safe-int-types']).toBeDefined();
    expect(DEFAULT_BEST_PRACTICES_CONFIG.rules['use-checked-arithmetic']).toBeDefined();
    expect(DEFAULT_BEST_PRACTICES_CONFIG.rules['use-initialization-functions']).toBeDefined();
    expect(DEFAULT_BEST_PRACTICES_CONFIG.rules['use-result-types']).toBeDefined();
    expect(DEFAULT_BEST_PRACTICES_CONFIG.rules['use-immutable-storage']).toBeDefined();
  });

  it('rejects config with invalid severity', () => {
    expect(() =>
      validateBestPracticesConfig({
        rules: {
          'use-safe-int-types': { enabled: true, severity: 'invalid' },
        },
      }),
    ).toThrow(BestPracticesConfigError);
  });

  it('rejects config missing rules', () => {
    expect(() => validateBestPracticesConfig({})).toThrow(BestPracticesConfigError);
  });

  it('rejects non-object config', () => {
    expect(() => validateBestPracticesConfig(null)).toThrow(BestPracticesConfigError);
    expect(() => validateBestPracticesConfig('string')).toThrow(BestPracticesConfigError);
  });
});

describe('best-practices / fixture validation', () => {
  const fixtures = [
    {
      path: './tests/rules/fixtures/best-practices/best-practices-safe-int-types.json',
      id: 'best-practices-safe-int-types-1',
      category: 'best-practices',
    },
    {
      path: './tests/rules/fixtures/best-practices/best-practices-checked-arithmetic.json',
      id: 'best-practices-checked-arithmetic-1',
      category: 'best-practices',
    },
    {
      path: './tests/rules/fixtures/best-practices/best-practices-initialization.json',
      id: 'best-practices-initialization-1',
      category: 'best-practices',
    },
    {
      path: './tests/rules/fixtures/best-practices/best-practices-result-types.json',
      id: 'best-practices-result-types-1',
      category: 'best-practices',
    },
    {
      path: './tests/rules/fixtures/best-practices/best-practices-immutable-storage.json',
      id: 'best-practices-immutable-storage-1',
      category: 'best-practices',
    },
  ];

  fixtures.forEach(({ path, id, category }) => {
    it(`fixture ${id} matches expected structure`, () => {
      const fixture = FixtureLoader.loadFixture(path);
      expect(fixture.id).toBe(id);
      expect(fixture.expectedFindings).toBeDefined();
      expect(fixture.expectedFindings.length).toBeGreaterThan(0);
      expect(fixture.metadata?.category).toBe(category);
    });

    it(`detector agrees with ${id} fixture violations`, () => {
      const fixture = FixtureLoader.loadFixture(path);
      let detected = false;

      switch (fixture.metadata?.category) {
        case 'best-practices':
          if (fixture.id.includes('safe-int-types')) {
            detected = detectUnsafeIntTypes(fixture.input).detected;
          } else if (fixture.id.includes('checked-arithmetic')) {
            detected = detectUncheckedArithmetic(fixture.input).detected;
          } else if (fixture.id.includes('initialization')) {
            detected = detectMissingInitialization(fixture.input).detected;
          } else if (fixture.id.includes('result-types')) {
            detected = detectMissingResultType(fixture.input).detected;
          } else if (fixture.id.includes('immutable-storage')) {
            detected = detectMutableStorageInView(fixture.input).detected;
          }
          break;
      }

      expect(detected).toBe(true);
    });
  });
});
