import {
  analyzeLedgerReadUsage,
  detectUnusedLedgerReads,
  analyzeRepeatedLedgerAccess,
  detectRepeatedLedgerAccess,
} from '../ledger';

const SOURCE_WITH_UNUSED_READ = `
pub fn process_payment(env: Env, sender: Address) {
    let unused = env.storage().instance().get::<_, u64>(&sender);
    let amount = env.storage().instance().get::<_, u64>(&DataKey::Amount);
    transfer_tokens(amount);
}
`;

const SOURCE_WITH_REPEATED_ACCESS = `
pub fn process_payment(env: Env, sender: Address) {
    let amount1 = env.storage().instance().get::<_, u64>(&DataKey::Amount);
    let amount2 = env.storage().instance().get::<_, u64>(&DataKey::Amount);
    transfer_tokens(amount1 + amount2);
}
`;

describe('Soroban Ledger Rules (#902 & #901)', () => {
  describe('Unused Ledger Reads (#902)', () => {
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

  describe('Repeated Ledger Access (#901)', () => {
    it('detectRepeatedLedgerAccess returns findings for repeated state accesses', () => {
      const findings = detectRepeatedLedgerAccess(SOURCE_WITH_REPEATED_ACCESS);

      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        ruleId: 'soroban-repeated-ledger-access',
        keyOrExpr: 'DataKey::Amount',
        fn: 'process_payment',
        firstAccessLine: 3,
      });
      expect(findings[0].suggestion).toContain("Reuse local variable 'amount1'");
    });

    it('analyzeRepeatedLedgerAccess returns a complete report', () => {
      const report = analyzeRepeatedLedgerAccess(SOURCE_WITH_REPEATED_ACCESS);

      expect(report.metrics).toEqual({
        totalAccesses: 2,
        repeatedAccesses: 1,
        uniqueKeysAccessed: 1,
      });
      expect(report.findings).toHaveLength(1);
    });
  });
});
