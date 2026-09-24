/**
 * Issue #923 — Tests for the Unsafe Transfer Assumption Rule
 */

import { detectUnsafeTransferAssumptions } from '../ignored-transfer-result-rule';

describe('Soroban Token Rules (#923)', () => {
  it('flags ignored try_transfer outcomes', () => {
    const src = `
pub fn pay(env: Env, from: Address, to: Address) {
    let client = token::Client::new(&env, &usdc);
    client.try_transfer(&from, &to, 100);
    env.storage().instance().set(&done, &true);
}
`;
    const report = detectUnsafeTransferAssumptions(src);
    expect(report.findings.length).toBe(1);
    expect(findings_ruleId(report)).toBe('soroban-ignored-transfer-result');
    expect(report.summary).toMatch(/ignored outcome/i);
  });

  it('does not flag handled transfers', () => {
    const src = `
pub fn pay_checked(env: Env, from: Address, to: Address) {
    let client = token::Client::new(&env, &usdc);
    client.try_transfer(&from, &to, 100)?;
    env.storage().instance().set(&done, &true);
}
`;
    const report = detectUnsafeTransferAssumptions(src);
    expect(report.metrics.ignoredOutcomes).toBe(0);
  });
});

function findings_ruleId(report: { findings: Array<{ ruleId: string }> }): string {
  return report.findings[0]?.ruleId;
}
