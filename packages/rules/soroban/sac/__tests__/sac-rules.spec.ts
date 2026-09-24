/**
 * Issues #920, #921 — Tests for Soroban SAC rules
 */

import {
  detectRedundantSacOperations,
  detectSacInteractions,
} from '../sac-rule';

describe('SAC Rules (#920, #921)', () => {
  const interactionContract = `
pub fn ops(env: Env, admin: Address, user: Address) {
    let usdc = token::Client::new(&env, &usdc_id);
    usdc.transfer(&user, &admin, 100);
    usdc.mint(&admin, &user, 500);
}

pub fn query_only(env: Env, user: Address) -> i128 {
    let sac = sac::Client::new(&env, &sac_id);
    sac.balance(&user)
}
`;

  it('detects SAC interactions (#920)', () => {
    const report = detectSacInteractions(interactionContract);
    const interactions = report.findings.filter((f) => f.ruleId === 'soroban-sac-interaction');
    expect(interactions.length).toBeGreaterThanOrEqual(3);
  });

  it('identifies asset operations (#920)', () => {
    const report = detectSacInteractions(interactionContract);
    const assetOps = report.findings.filter((f) => f.ruleId === 'soroban-sac-asset-operation');
    const methods = assetOps.map((f) => f.method).sort();
    expect(methods).toEqual(expect.arrayContaining(['mint', 'transfer']));
  });

  it('flags repeated identical SAC calls (#920)', () => {
    const src = `
pub fn churn(env: Env, user: Address) {
    let usdc = token::Client::new(&env, &usdc);
    usdc.transfer(&user, &user, 100);
    usdc.transfer(&user, &user, 100);
}
`;
    const report = detectSacInteractions(src);
    const repeated = report.findings.filter((f) => f.ruleId === 'soroban-sac-repeated-call');
    expect(repeated.length).toBe(1);
    expect(repeated[0].firstLine).toBeDefined();
  });

  it('flags redundant SAC operations with a first-line reference (#921)', () => {
    const src = `
pub fn twice(env: Env, admin: Address, user: Address) {
    let usdc = token::Client::new(&env, &usdc);
    usdc.mint(&admin, &user, 250);
    usdc.mint(&admin, &user, 250);
}
`;
    const report = detectRedundantSacOperations(src);
    expect(report.metrics.redundantOperations).toBe(1);
    expect(report.findings[0].firstLine).toBeLessThan(report.findings[0].line);
    expect(report.findings[0].operation).toBe('supply');
  });

  it('does not flag exclusive-branch operations as redundant (#921)', () => {
    const src = `
pub fn branchy(env: Env, admin: Address, user: Address, flag: bool) {
    let usdc = token::Client::new(&env, &usdc);
    if flag {
        usdc.mint(&admin, &user, 250);
    } else {
        usdc.mint(&admin, &user, 250);
    }
}
`;
    const report = detectRedundantSacOperations(src);
    expect(report.metrics.redundantOperations).toBe(0);
  });

  it('ignores queries for the redundant rule (#921)', () => {
    const src = `
pub fn reads(env: Env, user: Address) -> i128 {
    let sac = sac::Client::new(&env, &sac_id);
    let a = sac.balance(&user);
    let b = sac.balance(&user);
    a + b
}
`;
    const report = detectRedundantSacOperations(src);
    expect(report.metrics.redundantOperations).toBe(0);
  });
});
