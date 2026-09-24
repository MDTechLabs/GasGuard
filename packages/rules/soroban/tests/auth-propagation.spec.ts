import {
  detectMissingAuthPropagation,
  AuthPropagationRule,
} from '../auth/auth-propagation.rule';

const TOKEN_CLIENT = `
pub fn pay_out(env: Env, from: Address, to: Address, amount: i128) {
    let client = token::Client::new(&env, &token_id);
    client.transfer(&from, &to, &amount);
}

pub fn safe_pay(env: Env, from: Address, to: Address, amount: i128) {
    from.require_auth();
    let client = token::Client::new(&env, &token_id);
    client.transfer(&from, &to, &amount);
}

pub fn read_only(env: Env, user: Address) -> u64 {
    let client = token::Client::new(&env, &token_id);
    client.balance(&user)
}

pub fn register_user(env: Env) {
    let client = token::Client::new(&env, &token_id);
    client.mint(&Address::generate(&env), &100i128);
}
`;

describe('Soroban auth propagation analyzer (#919)', () => {
  const rule = new AuthPropagationRule();

  it('flags cross-contract calls that pass unauthenticated Address args', () => {
    const report = rule.evaluate(TOKEN_CLIENT);

    const flagged = report.findings.filter((f) => f.caller === 'pay_out');
    expect(flagged.length).toBe(1);
    expect(flagged[0].callee).toBe('client.transfer');
    expect(flagged[0].addressArgs.join(' ')).toMatch(/from/);
    expect(flagged[0].callPath).toBe('pay_out -> client.transfer');
    expect(flagged[0].severity).toBe('high');
    expect(report.summary).toMatch(/missing authorization propagation/i);
  });

  it('does not flag functions that propagate authorization', () => {
    const report = rule.evaluate(TOKEN_CLIENT);
    for (const finding of report.findings) {
      expect(finding.caller).not.toBe('safe_pay');
    }
  });

  it('ignores read-only client calls (balance reads)', () => {
    const report = rule.evaluate(TOKEN_CLIENT);
    for (const finding of report.findings) {
      expect(finding.caller).not.toBe('read_only');
    }
  });

  it('ignores calls whose only args are locally generated addresses', () => {
    const report = rule.evaluate(TOKEN_CLIENT);
    for (const finding of report.findings) {
      expect(finding.caller).not.toBe('register_user');
    }
  });

  it('reports affected call paths in the metrics', () => {
    const report = rule.evaluate(TOKEN_CLIENT);
    expect(report.metrics.flaggedCallPaths).toBe(report.findings.length);
    expect(report.metrics.crossContractCalls).toBeGreaterThanOrEqual(4);
    expect(report.metrics.authedFunctions).toBeGreaterThanOrEqual(1);
  });

  it('summarizes clean contracts positively', () => {
    const report = rule.evaluate(`
pub fn guarded(env: Env, from: Address, to: Address, amount: i128) {
    from.require_auth();
    let client = token::Client::new(&env, &token_id);
    client.transfer(&from, &to, &amount);
}
`);
    expect(report.findings).toHaveLength(0);
    expect(report.summary).toMatch(/propagated/i);
  });
});
