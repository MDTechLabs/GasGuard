/**
 * Issue #904 — Tests for Overloaded Soroban Entry-Point Rules
 */

import {
  detectOverloadedEntryPoints,
  validateEntryPointComplexity,
  detectEntryPointIssues,
} from '../entry-point-rule';

describe('Overloaded Entry-Point Rules (#904)', () => {
  const cleanContract = `
    #[contract]
    pub struct CleanContract;

    #[contractimpl]
    impl CleanContract {
        pub fn ping(env: Env) -> u32 {
            1
        }

        pub fn set_value(env: Env, admin: Address, val: u32) {
            admin.require_auth();
            env.storage().instance().set(&symbol_short!("val"), &val);
        }
    }
  `;

  const overloadedContract = `
    #[contract]
    pub struct OverloadedContract;

    #[contractimpl]
    impl OverloadedContract {
        pub fn do_excessive_work(
            env: Env,
            admin: Address,
            u1: Address,
            u2: Address,
            u3: Address,
            token_a: Address,
            token_b: Address,
            amount: i128,
            flag: bool,
        ) {
            admin.require_auth();

            // Excessive storage operations
            env.storage().instance().set(&symbol_short!("a"), &1);
            env.storage().instance().set(&symbol_short!("b"), &2);
            env.storage().persistent().set(&u1, &amount);
            env.storage().persistent().set(&u2, &amount);
            env.storage().persistent().set(&u3, &amount);
            env.storage().temporary().set(&symbol_short!("tmp"), &10);

            // Excessive external calls
            env.invoke_contract(&token_a, &symbol_short!("sync"), &args);
            env.invoke_contract(&token_b, &symbol_short!("sync"), &args);
            let client = TokenClient::new(&env, &token_a);
            client.transfer(&admin, &u1, &amount);
            client.transfer(&admin, &u2, &amount);

            // Cyclomatic branching
            if flag {
                if amount > 1000 {
                    let _ = client.balance(&u1);
                } else if amount > 500 {
                    let _ = client.balance(&u2);
                }
            } else {
                for i in 0..5 {
                    env.storage().persistent().set(&i, &true);
                }
            }
        }
    }
  `;

  describe('detectOverloadedEntryPoints', () => {
    it('reports no overloaded entry points for modular contracts', () => {
      const report = detectOverloadedEntryPoints(cleanContract);
      expect(report.overloadedCount).toBe(0);
      expect(report.findings).toHaveLength(0);
      expect(report.summary).toContain('acceptable complexity');
    });

    it('detects overloaded entry point handling excessive responsibilities', () => {
      const report = detectOverloadedEntryPoints(overloadedContract);
      expect(report.overloadedCount).toBe(1);
      expect(report.findings.length).toBeGreaterThanOrEqual(3);

      const findings = report.findings.filter(
        (f) => f.ruleId === 'soroban-overloaded-entry-point',
      );
      expect(findings.length).toBeGreaterThanOrEqual(3);

      // Verify dimensions
      const storageFinding = findings.find((f) => f.dimension === 'storage_operations');
      expect(storageFinding).toBeDefined();
      expect(storageFinding!.entryPointName).toBe('do_excessive_work');
      expect(storageFinding!.metricValue).toBeGreaterThan(5);

      const callsFinding = findings.find((f) => f.dimension === 'external_calls');
      expect(callsFinding).toBeDefined();
      expect(callsFinding!.metricValue).toBeGreaterThan(3);

      const paramsFinding = findings.find((f) => f.dimension === 'parameter_count');
      expect(paramsFinding).toBeDefined();
      expect(paramsFinding!.metricValue).toBeGreaterThan(6);
    });

    it('respects custom threshold limits', () => {
      const strictThresholds = {
        maxStorageOperations: 1,
        maxParameters: 2,
      };

      const report = detectOverloadedEntryPoints(cleanContract, strictThresholds);
      expect(report.overloadedCount).toBeGreaterThan(0);

      const relaxedThresholds = {
        maxCyclomaticComplexity: 50,
        maxCognitiveComplexity: 50,
        maxLinesOfCode: 200,
        maxStorageOperations: 50,
        maxStorageWrites: 50,
        maxExternalCalls: 50,
        maxParameters: 50,
        maxOverloadScore: 100,
      };

      const relaxedReport = detectOverloadedEntryPoints(overloadedContract, relaxedThresholds);
      expect(relaxedReport.overloadedCount).toBe(0);
      expect(relaxedReport.findings).toHaveLength(0);
    });
  });

  describe('validateEntryPointComplexity', () => {
    it('returns only complexity and overload findings', () => {
      const findings = validateEntryPointComplexity(overloadedContract);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings.every((f) => f.category === 'complexity')).toBe(true);
      expect(findings.every((f) => f.ruleId === 'soroban-overloaded-entry-point')).toBe(true);
    });
  });

  describe('Integration with detectEntryPointIssues', () => {
    it('includes overloaded entry point findings in full entry point report', () => {
      const report = detectEntryPointIssues(overloadedContract);
      const overloadFinding = report.findings.find(
        (f) => f.ruleId === 'soroban-overloaded-entry-point',
      );
      expect(overloadFinding).toBeDefined();
      expect(overloadFinding!.category).toBe('complexity');
    });
  });
});
