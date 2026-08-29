import {
  analyzeRepeatedLedgerAccesses,
  extractLedgerAccesses,
  generateRepeatedAccessFindings,
} from '../repeated-ledger-access-analyzer';

const REPEATED_INSTANCE_READ = `
pub fn process_order(env: Env, key: Symbol) {
    let val1 = env.storage().instance().get::<_, u64>(&key);
    let val2 = env.storage().instance().get::<_, u64>(&key);
    pay_out(val1 + val2);
}
`;

const EXCLUSIVE_BRANCH_READS = `
pub fn check_state(env: Env, key: Symbol, flag: bool) {
    if flag {
        let a = env.storage().persistent().get::<_, u32>(&key);
    } else {
        let b = env.storage().persistent().get::<_, u32>(&key);
    }
}
`;

const LOOP_REPEATED_ACCESS = `
pub fn batch_process(env: Env, keys: Vec<Symbol>) {
    for key in keys.iter() {
        let item = env.storage().temporary().get::<_, u32>(&key);
    }
}
`;

const MULTIPLE_DIFFERENT_KEYS = `
pub fn multi_access(env: Env, key1: Symbol, key2: Symbol) {
    let v1 = env.storage().instance().get::<_, u64>(&key1);
    let v2 = env.storage().instance().get::<_, u64>(&key2);
}
`;

describe('RepeatedLedgerAccessAnalyzer', () => {
  describe('extractLedgerAccesses', () => {
    it('extracts ledger accesses and captures line numbers and keys', () => {
      const accesses = extractLedgerAccesses(REPEATED_INSTANCE_READ);

      expect(accesses).toHaveLength(2);
      expect(accesses[0]).toMatchObject({
        fn: 'process_order',
        storageKind: 'instance',
        operation: 'get',
        keyOrExpr: 'key',
        assignedVar: 'val1',
      });
      expect(accesses[1]).toMatchObject({
        fn: 'process_order',
        storageKind: 'instance',
        operation: 'get',
        keyOrExpr: 'key',
        assignedVar: 'val2',
      });
    });

    it('ignores comments and string literal mock accesses', () => {
      const source = `
        pub fn mock(env: Env) {
            // let x = env.storage().instance().get(&key);
            let s = "env.storage().instance().get(&key)";
        }
      `;
      const accesses = extractLedgerAccesses(source);
      expect(accesses).toHaveLength(0);
    });
  });

  describe('generateRepeatedAccessFindings', () => {
    it('detects repeated reads on the same key and suggests variable reuse', () => {
      const accesses = extractLedgerAccesses(REPEATED_INSTANCE_READ);
      const findings = generateRepeatedAccessFindings(accesses);

      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        ruleId: 'soroban-repeated-ledger-access',
        severity: 'high',
        keyOrExpr: 'key',
        firstAccessLine: 3,
        fn: 'process_order',
      });
      expect(findings[0].suggestion).toContain("Reuse local variable 'val1'");
    });

    it('does not flag access on exclusive conditional branches', () => {
      const accesses = extractLedgerAccesses(EXCLUSIVE_BRANCH_READS);
      const findings = generateRepeatedAccessFindings(accesses);

      expect(findings).toHaveLength(0);
    });
  });

  describe('analyzeRepeatedLedgerAccesses', () => {
    it('returns full report with calculated metrics', () => {
      const report = analyzeRepeatedLedgerAccesses(REPEATED_INSTANCE_READ);

      expect(report.metrics).toEqual({
        totalAccesses: 2,
        repeatedAccesses: 1,
        uniqueKeysAccessed: 1,
      });
      expect(report.findings).toHaveLength(1);
    });

    it('returns zero repeated accesses when all accessed keys are distinct', () => {
      const report = analyzeRepeatedLedgerAccesses(MULTIPLE_DIFFERENT_KEYS);

      expect(report.metrics.totalAccesses).toBe(2);
      expect(report.metrics.repeatedAccesses).toBe(0);
      expect(report.metrics.uniqueKeysAccessed).toBe(2);
      expect(report.findings).toHaveLength(0);
    });
  });
});
