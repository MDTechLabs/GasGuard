import {
  analyzeLedgerReadUsage,
  detectUnusedLedgerReads,
} from '../ledger/unused-ledger-reads-rule';

const SOURCE_WITH_UNUSED_READ = `
pub fn process_payment(env: Env, sender: Address) {
    let unused = env.storage().instance().get::<_, u64>(&sender);
    let amount = env.storage().instance().get::<_, u64>(&DataKey::Amount);
    transfer_tokens(amount);
}
`;

describe('Soroban Ledger Rules (#902)', () => {
  it('detectUnusedLedgerReads returns findings for unused state reads', () => {
    const findings = detectUnusedLedgerReads(SOURCE_WITH_UNUSED_READ);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'soroban-unused-ledger-read',
      assignedVar: 'unused',
      fn: 'process_payment',
    });
  });

  it('analyzeLedgerReadUsage returns a complete report', () => {
    const report = analyzeLedgerReadUsage(SOURCE_WITH_UNUSED_READ);

    expect(report.metrics).toEqual({
      totalReads: 2,
      consumedReads: 1,
      unusedReads: 1,
    });
    expect(report.findings).toHaveLength(1);
  });
});
