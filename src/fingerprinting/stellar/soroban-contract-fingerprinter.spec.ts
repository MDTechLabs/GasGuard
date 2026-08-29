import { SorobanContractFingerprinter } from './soroban-contract-fingerprinter';

const CONTRACT_A = `
impl TokenContract {
  pub fn new(env: Env) -> Self { Self {} }
  pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {}
  fn validate(amount: i128) -> bool { amount > 0 }
}
`;

const CONTRACT_B = `
impl TokenContract {
  pub fn new(env: Env) -> Self { Self {} }
  pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {}
  fn validate(amount: i128) -> bool { amount > 0 }
}
`;

const CONTRACT_C = `
impl StakingContract {
  pub fn stake(env: Env, amount: i128) {}
}
`;

describe('SorobanContractFingerprinter', () => {
  let fingerprinter: SorobanContractFingerprinter;

  beforeEach(() => {
    fingerprinter = new SorobanContractFingerprinter();
  });

  describe('fingerprint', () => {
    it('should generate a fingerprint with expected fields', () => {
      const fp = fingerprinter.fingerprint(CONTRACT_A, 'contracts/token.rs');
      expect(fp.fingerprint).toBeTruthy();
      expect(fp.structuralHash).toBeTruthy();
      expect(fp.contractName).toBe('TokenContract');
      expect(fp.functionCount).toBeGreaterThan(0);
    });

    it('should produce the same fingerprint for identical sources', () => {
      const fp1 = fingerprinter.fingerprint(CONTRACT_A, 'a.rs');
      const fp2 = fingerprinter.fingerprint(CONTRACT_B, 'b.rs');
      expect(fp1.fingerprint).toBe(fp2.fingerprint);
    });

    it('should produce different fingerprints for different sources', () => {
      const fp1 = fingerprinter.fingerprint(CONTRACT_A, 'a.rs');
      const fp2 = fingerprinter.fingerprint(CONTRACT_C, 'c.rs');
      expect(fp1.fingerprint).not.toBe(fp2.fingerprint);
    });
  });

  describe('detectDuplicates', () => {
    it('should detect exact duplicates', () => {
      fingerprinter.fingerprint(CONTRACT_A, 'a.rs');
      fingerprinter.fingerprint(CONTRACT_B, 'b.rs');
      const duplicates = fingerprinter.detectDuplicates();
      expect(duplicates).toHaveLength(1);
      expect(duplicates[0].similarity).toBe('exact');
    });

    it('should return no duplicates for unique contracts', () => {
      fingerprinter.fingerprint(CONTRACT_A, 'a.rs');
      fingerprinter.fingerprint(CONTRACT_C, 'c.rs');
      expect(fingerprinter.detectDuplicates()).toHaveLength(0);
    });
  });

  describe('generateReport', () => {
    it('should report duplicate and unique counts', () => {
      fingerprinter.fingerprint(CONTRACT_A, 'a.rs');
      fingerprinter.fingerprint(CONTRACT_B, 'b.rs');
      fingerprinter.fingerprint(CONTRACT_C, 'c.rs');
      const report = fingerprinter.generateReport();
      expect(report.duplicateCount).toBe(1);
      expect(report.uniqueCount).toBe(2);
    });
  });
});
