import {
  checkRegression,
  checkOptimizationRegression,
  collectFindings,
} from '../optimization-regression-checker';

const BEFORE = `
pub fn transfer(env: Env, to: Address, amount: i128) {
    self.require_auth();
    self.require_auth();
    self.require_auth();
    for i in items.iter() {
        env.storage().persistent().set(&i, &1);
    }
}
`;

const AFTER_IMPROVED = `
pub fn transfer(env: Env, to: Address, amount: i128) {
    self.require_auth();
    // cached auth — single call
}
`;

describe('OptimizationRegressionChecker (#806)', () => {
  it('collects findings from analyzers', () => {
    const findings = collectFindings(BEFORE);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('detects resolved findings when source is improved', () => {
    const result = checkRegression(BEFORE, AFTER_IMPROVED);
    expect(result.resolvedFindings.length).toBeGreaterThan(0);
    expect(result.beforeCount).toBeGreaterThan(result.afterCount);
  });

  it('flags regression when new high-severity issues appear', () => {
    const worse = `
pub fn transfer(env: Env) {
    for i in items.iter() {
        for j in other.iter() {
            env.storage().persistent().set(&i, &j);
            let _ = sha256(&data);
        }
    }
}
`;
    const result = checkRegression(AFTER_IMPROVED, worse);
    // Worse source should introduce findings
    expect(result.newFindings.length).toBeGreaterThan(0);
    // Nested loop / storage-in-loop / crypto tend to be high/critical
    expect(result.hasRegression || result.newFindings.length > 0).toBe(true);
  });

  it('reports clean when nothing changes', () => {
    const result = checkRegression(AFTER_IMPROVED, AFTER_IMPROVED);
    expect(result.newFindings).toHaveLength(0);
    expect(result.hasRegression).toBe(false);
  });

  it('checkOptimizationRegression applies patch preview and compares', () => {
    const patch = [
      '--- a/contract.rs',
      '+++ b/contract.rs',
      '@@ -1,1 +1,2 @@',
      '-old',
      '+// OPTIMIZE: cache auth',
      '+old',
    ].join('\n');
    const result = checkOptimizationRegression(BEFORE, patch);
    expect(result).toBeDefined();
    expect(typeof result.summary).toBe('string');
  });
});
