import {
  analyzeUnusedLedgerReads,
  extractLedgerReads,
  generateLedgerReadFindings,
} from '../unused-ledger-read-analyzer';

const UNUSED_INSTANCE_READ = `
pub fn process_order(env: Env, key: Symbol) {
    let unused_val = env.storage().instance().get::<_, u64>(&key);
    let used_val = env.storage().instance().get::<_, u64>(&DataKey::Config);
    pay_out(used_val);
}
`;

const WILDCARD_AND_STATEMENT_READS = `
pub fn check_state(env: Env, key: Symbol) {
    let _ = env.storage().persistent().get::<_, u32>(&key);
    env.storage().temporary().get::<_, u32>(&key);
}
`;

const CONSUMED_READS = `
pub fn execute(env: Env, key: Symbol) -> u64 {
    if env.storage().instance().has(&key) {
        let val = env.storage().instance().get(&key).unwrap();
        return val + 1;
    }
    0
}
`;

const LEDGER_ENV_READS = `
pub fn audit(env: Env) {
    let ts = env.ledger().timestamp();
    let unused_seq = env.ledger().sequence();
    log_time(ts);
}
`;

describe('UnusedLedgerReadAnalyzer', () => {
  describe('extractLedgerReads', () => {
    it('extracts instance, persistent, and temporary storage reads', () => {
      const reads = extractLedgerReads(UNUSED_INSTANCE_READ);

      expect(reads).toHaveLength(2);
      expect(reads[0]).toMatchObject({
        fn: 'process_order',
        storageKind: 'instance',
        operation: 'get',
        assignedVar: 'unused_val',
        isConsumed: false,
      });
      expect(reads[1]).toMatchObject({
        fn: 'process_order',
        storageKind: 'instance',
        operation: 'get',
        assignedVar: 'used_val',
        isConsumed: true,
      });
    });

    it('identifies wildcard and statement-only reads', () => {
      const reads = extractLedgerReads(WILDCARD_AND_STATEMENT_READS);

      expect(reads).toHaveLength(2);
      expect(reads[0]).toMatchObject({
        storageKind: 'persistent',
        isWildcard: true,
        isConsumed: false,
      });
      expect(reads[1]).toMatchObject({
        storageKind: 'temporary',
        isStatementOnly: true,
        isConsumed: false,
      });
    });

    it('correctly marks consumed reads used in returns and conditionals', () => {
      const reads = extractLedgerReads(CONSUMED_READS);

      expect(reads).toHaveLength(2);
      expect(reads[0].isConsumed).toBe(true);
      expect(reads[1].isConsumed).toBe(true);
    });

    it('extracts ledger environment reads like timestamp and sequence', () => {
      const reads = extractLedgerReads(LEDGER_ENV_READS);

      expect(reads).toHaveLength(2);
      expect(reads[0]).toMatchObject({
        storageKind: 'ledger',
        operation: 'timestamp',
        isConsumed: true,
      });
      expect(reads[1]).toMatchObject({
        storageKind: 'ledger',
        operation: 'sequence',
        isConsumed: false,
      });
    });

    it('ignores reads in comments and string literals', () => {
      const source = `
        pub fn doc(env: Env) {
            // let x = env.storage().instance().get(&key);
            let s = "env.storage().instance().get(&key)";
        }
      `;
      const reads = extractLedgerReads(source);
      expect(reads).toHaveLength(0);
    });
  });

  describe('generateLedgerReadFindings', () => {
    it('generates findings for unused assigned variables', () => {
      const reads = extractLedgerReads(UNUSED_INSTANCE_READ);
      const findings = generateLedgerReadFindings(reads);

      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        ruleId: 'soroban-unused-ledger-read',
        severity: 'medium',
        assignedVar: 'unused_val',
        fn: 'process_order',
      });
      expect(findings[0].suggestion).toContain('Remove the unused ledger read');
    });

    it('generates high severity findings for wildcard and statement-only reads', () => {
      const reads = extractLedgerReads(WILDCARD_AND_STATEMENT_READS);
      const findings = generateLedgerReadFindings(reads);

      expect(findings).toHaveLength(2);
      expect(findings.every((f) => f.severity === 'high')).toBe(true);
    });
  });

  describe('analyzeUnusedLedgerReads', () => {
    it('returns full report with metrics', () => {
      const report = analyzeUnusedLedgerReads(UNUSED_INSTANCE_READ);

      expect(report.metrics).toEqual({
        totalReads: 2,
        consumedReads: 1,
        unusedReads: 1,
      });
      expect(report.findings).toHaveLength(1);
    });

    it('handles clean code with 0 unused reads', () => {
      const report = analyzeUnusedLedgerReads(CONSUMED_READS);

      expect(report.metrics.unusedReads).toBe(0);
      expect(report.findings).toHaveLength(0);
    });
  });
});
