/**
 * Issue #923 — Tests for the Ignored Token Transfer Result Analyzer
 */

import {
  analyzeIgnoredTransferResults,
  findIgnoredTransferResults,
} from '../ignored-transfer-result-analyzer';

describe('IgnoredTransferResultAnalyzer (#923)', () => {
  it('detects token transfer calls', () => {
    const src = `
pub fn pay(env: Env, from: Address, to: Address) {
    let client = token::Client::new(&env, &usdc);
    client.transfer(&from, &to, 100);
}
`;
    const report = analyzeIgnoredTransferResults(src);
    expect(report.metrics.transferCalls).toBe(1);
    expect(report.sites[0].asset).toBe('usdc');
    expect(report.sites[0].method).toBe('transfer');
  });

  it('flags a try_transfer result that is fully discarded', () => {
    const src = `
pub fn send(env: Env, from: Address, to: Address) {
    let client = token::Client::new(&env, &usdc);
    client.try_transfer(&from, &to, 100);
    env.storage().instance().set(&paid, &true);
}
`;
    const findings = findIgnoredTransferResults(src);
    expect(findings.length).toBe(1);
    expect(findings[0].severity).toBe('high');
    expect(findings[0].suggestion).toMatch(/try_/i);
  });

  it('does not flag a try_transfer that is handled', () => {
    const src = `
pub fn send_checked(env: Env, from: Address, to: Address) -> Result<(), Error> {
    let client = token::Client::new(&env, &usdc);
    client.try_transfer(&from, &to, 100)?;
    Ok(())
}
`;
    expect(findIgnoredTransferResults(src)).toHaveLength(0);
  });

  it('flags captured results that are never observed', () => {
    const src = `
pub fn send_captured(env: Env, from: Address, to: Address) {
    let client = token::Client::new(&env, &usdc);
    let res = client.try_transfer(&from, &to, 100);
    env.storage().instance().set(&paid, &true);
}
`;
    const findings = findIgnoredTransferResults(src);
    expect(findings.length).toBe(1);
  });

  it('does not flag observed results', () => {
    const src = `
pub fn send_observed(env: Env, from: Address, to: Address) {
    let client = token::Client::new(&env, &usdc);
    let res = client.try_transfer(&from, &to, 100);
    env.storage().instance().set(&paid, &(res != Err(Ok(()))));
}
`;
    expect(findIgnoredTransferResults(src)).toHaveLength(0);
  });

  it('aggregates metrics in the report', () => {
    const src = `
pub fn many(env: Env, from: Address, to: Address) {
    let client = token::Client::new(&env, &usdc);
    client.try_transfer(&from, &to, 100);
}
`;
    const report = analyzeIgnoredTransferResults(src);
    expect(report.metrics.transferCalls).toBe(1);
    expect(report.metrics.ignoredOutcomes).toBe(1);
  });
});
