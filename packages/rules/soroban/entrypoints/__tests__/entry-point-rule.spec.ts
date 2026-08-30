/**
 * Issue #903 — Tests for Soroban Entry-Point Rules
 */

import {
  detectEntryPointIssues,
  analyzeSorobanEntryPoints,
  validateEntryPointAuthorization,
  validateEntryPointExternalCalls,
  validateEntryPointStorage,
} from '../entry-point-rule';

describe('Soroban Entry-Point Rules (#903)', () => {
  const cleanContract = `
    #[contract]
    pub struct CleanVault;

    #[contractimpl]
    impl CleanVault {
        pub fn init(env: Env, admin: Address) {
            admin.require_auth();
            env.storage().instance().set(&symbol_short!("admin"), &admin);
        }

        pub fn get_balance(env: Env, user: Address) -> i128 {
            env.storage().persistent().get(&user).unwrap_or(0)
        }
    }
  `;

  const vulnerableContract = `
    #[contract]
    pub struct VulnerableContract;

    #[contractimpl]
    impl VulnerableContract {
        pub fn unprotected_transfer(env: Env, recipient: Address, token: Address) {
            let client = TokenClient::new(&env, &token);
            client.transfer(&env.current_contract_address(), &recipient, &1000);
        }

        pub fn looped_external_call(env: Env, targets: Vec<Address>) {
            for target in targets.iter() {
                env.invoke_contract(&target, &symbol_short!("ping"), &args);
            }
        }

        pub fn looped_storage_write(env: Env, items: Vec<i128>) {
            for item in items.iter() {
                env.storage().persistent().set(&item, &true);
            }
        }

        pub fn looped_auth(env: Env, users: Vec<Address>) {
            for user in users.iter() {
                user.require_auth();
            }
        }
    }
  `;

  describe('detectEntryPointIssues', () => {
    it('returns 0 critical/high findings for clean contracts', () => {
      const report = detectEntryPointIssues(cleanContract);
      const criticalOrHigh = report.findings.filter(
        (f) => f.severity === 'critical' || f.severity === 'high',
      );
      expect(criticalOrHigh).toHaveLength(0);
      expect(report.unprotectedCount).toBe(0);
      expect(report.publicCount).toBe(2);
    });

    it('detects all entry point issue categories in vulnerable contract', () => {
      const report = detectEntryPointIssues(vulnerableContract);
      expect(report.findings.length).toBeGreaterThanOrEqual(4);

      const unprotectedFinding = report.findings.find(
        (f) => f.ruleId === 'soroban-unprotected-entry-point',
      );
      expect(unprotectedFinding).toBeDefined();
      expect(unprotectedFinding!.severity).toBe('critical');

      const callInLoopFinding = report.findings.find(
        (f) => f.ruleId === 'soroban-entry-point-call-in-loop',
      );
      expect(callInLoopFinding).toBeDefined();
      expect(callInLoopFinding!.severity).toBe('high');

      const storageInLoopFinding = report.findings.find(
        (f) => f.ruleId === 'soroban-entry-point-storage-in-loop',
      );
      expect(storageInLoopFinding).toBeDefined();

      const authInLoopFinding = report.findings.find(
        (f) => f.ruleId === 'soroban-entry-point-auth-in-loop',
      );
      expect(authInLoopFinding).toBeDefined();
    });
  });

  describe('Specific Validators', () => {
    it('validateEntryPointAuthorization returns only authorization findings', () => {
      const findings = validateEntryPointAuthorization(vulnerableContract);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings.every((f) => f.category === 'authorization')).toBe(true);
    });

    it('validateEntryPointExternalCalls returns only external call findings', () => {
      const findings = validateEntryPointExternalCalls(vulnerableContract);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings.every((f) => f.category === 'external_calls')).toBe(true);
    });

    it('validateEntryPointStorage returns only storage findings', () => {
      const findings = validateEntryPointStorage(vulnerableContract);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings.every((f) => f.category === 'storage')).toBe(true);
    });
  });

  describe('analyzeSorobanEntryPoints alias', () => {
    it('behaves identically to detectEntryPointIssues', () => {
      const report = analyzeSorobanEntryPoints(cleanContract);
      expect(report.entryPoints.length).toBe(2);
      expect(report.summary).toContain('CleanVault');
    });
  });
});
