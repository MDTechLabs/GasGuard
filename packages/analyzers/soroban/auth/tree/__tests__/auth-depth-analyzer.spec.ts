import { measureAuthDepth } from '../auth-depth-analyzer';

describe('Authorization Depth Analyzer (#918)', () => {
  const SHALLOW_AUTH = `
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        // transfer logic
    }
  `;

  const DEEP_AUTH = `
    pub fn complex_transfer(env: Env, master: Address, sub: Address, to: Address, amount: i128) {
        master.require_auth();
        sub.require_auth();
        admin.authorize_as_parent();
        vault.check_auth();
    }
  `;

  const NO_AUTH = `
    pub fn view_balance(env: Env, account: Address) -> i128 {
        storage::get(&account)
    }
  `;

  const MIXED = `
    pub fn simple(env: Env, user: Address) {
        user.require_auth();
    }

    pub fn complex(env: Env, a: Address, b: Address, c: Address) {
        a.require_auth();
        b.authorize_as_parent();
        c.check_auth();
    }
  `;

  test('measureAuthDepth returns zero depth for functions without auth', () => {
    const report = measureAuthDepth(NO_AUTH);
    expect(report.results.length).toBe(1);
    expect(report.results[0].depth).toBe(0);
    expect(report.maxDepth).toBe(0);
    expect(report.violations).toHaveLength(0);
  });

  test('measureAuthDepth counts single auth call', () => {
    const report = measureAuthDepth(SHALLOW_AUTH);
    expect(report.results[0].depth).toBe(1);
    expect(report.maxDepth).toBe(1);
    expect(report.violations).toHaveLength(0);
  });

  test('measureAuthDepth detects deep auth nesting', () => {
    const report = measureAuthDepth(DEEP_AUTH, 3);
    expect(report.results[0].depth).toBe(4);
    expect(report.maxDepth).toBe(4);
    expect(report.violations.length).toBeGreaterThanOrEqual(1);
    expect(report.violations[0].functionName).toBe('complex_transfer');
  });

  test('measureAuthDepth identifies deepest function', () => {
    const report = measureAuthDepth(MIXED, 2);
    expect(report.deepestFunction).toBeDefined();
    expect(report.deepestFunction!.functionName).toBe('complex');
    expect(report.deepestFunction!.depth).toBe(3);
  });

  test('measureAuthDepth generates recommendations for violations', () => {
    const report = measureAuthDepth(DEEP_AUTH, 2);
    expect(report.recommendations.length).toBeGreaterThan(0);
    expect(report.recommendations.some((r) => r.includes('authorization depth'))).toBe(true);
  });

  test('measureAuthDepth is deterministic', () => {
    const r1 = measureAuthDepth(MIXED, 2);
    const r2 = measureAuthDepth(MIXED, 2);
    expect(r1.maxDepth).toBe(r2.maxDepth);
    expect(r1.violations.length).toBe(r2.violations.length);
  });

  test('measureAuthDepth respects configurable threshold', () => {
    const strict = measureAuthDepth(SHALLOW_AUTH, 1);
    expect(strict.violations).toHaveLength(1);

    const relaxed = measureAuthDepth(SHALLOW_AUTH, 5);
    expect(relaxed.violations).toHaveLength(0);
  });
});
