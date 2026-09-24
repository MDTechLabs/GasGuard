/**
 * Issue #920 — Tests for the Soroban SAC Interaction Analyzer
 */

import {
  analyzeSacInteractions,
  extractSacCallSites,
  sacInteractionFindings,
} from '../sac-interaction-analyzer';

describe('SacInteractionAnalyzer (#920)', () => {
  const sacContract = `
pub fn move_tokens(env: Env, admin: Address, user: Address) {
    let usdc = token::Client::new(&env, &usdc_id);
    usdc.transfer(&user, &user, 100);
    usdc.mint(&admin, &user, 500);
    usdc.transfer(&user, &admin, 100);
}

pub fn queries(env: Env, user: Address) -> i128 {
    let sac = sac::Client::new(&env, &sac_id);
    sac.balance(&user)
}
`;

  it('detects SAC interactions from bound and inline clients', () => {
    const report = analyzeSacInteractions(sacContract);
    expect(report.metrics.totalSacCalls).toBeGreaterThanOrEqual(4);
  });

  it('identifies asset operations', () => {
    const report = analyzeSacInteractions(sacContract);
    const methods = report.assetOperations.map((s) => s.method).sort();
    expect(methods).toContain('mint');
    expect(methods).toContain('transfer');
  });

  it('tracks repeated calls with identical inputs on the same path', () => {
    const src = `
pub fn churn(env: Env, user: Address) {
    let usdc = token::Client::new(&env, &usdc);
    usdc.transfer(&user, &user, 100);
    usdc.transfer(&user, &user, 100);
}
`;
    const report = analyzeSacInteractions(src);
    expect(report.metrics.repeatedCalls).toBe(1);
    expect(report.repeatedCalls[0].method).toBe('transfer');
    expect(report.repeatedCalls[0].argsFingerprint).toContain('user');
  });

  it('does not treat exclusive-branch calls as repeated', () => {
    const src = `
pub fn branchy(env: Env, user: Address, flag: bool) {
    let usdc = token::Client::new(&env, &usdc);
    if flag {
        usdc.transfer(&user, &user, 100);
    } else {
        usdc.transfer(&user, &user, 100);
    }
}
`;
    const report = analyzeSacInteractions(src);
    expect(report.metrics.repeatedCalls).toBe(0);
  });

  it('skips non-SAC receivers like env', () => {
    const src = `
pub fn misc(env: Env) {
    env.storage().instance().set(&k, &v);
}
`;
    expect(extractSacCallSites(src)).toHaveLength(0);
  });

  it('reports loop-based SAC interactions at high severity', () => {
    const src = `
pub fn payout(env: Env, users: Vec<Address>) {
    let usdc = token::Client::new(&env, &usdc);
    for user in users.iter() {
        usdc.transfer(&admin, &user, 1);
    }
}
`;
    const { interactions } = sacInteractionFindings(src);
    const inLoop = interactions.filter((f) => f.severity === 'high');
    expect(inLoop.length).toBeGreaterThanOrEqual(1);
  });
});
