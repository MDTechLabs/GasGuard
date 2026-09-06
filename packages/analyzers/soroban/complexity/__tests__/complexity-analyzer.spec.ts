/**
 * Issue #904 — Tests for Soroban Overloaded Entry-Point Analyzer
 */

import {
  SorobanComplexityAnalyzer,
  analyzeEntryPointComplexity,
  DEFAULT_THRESHOLDS,
} from '../complexity-analyzer';

describe('SorobanComplexityAnalyzer (#904)', () => {
  const cleanContract = `
    #[contract]
    pub struct SimpleVault;

    #[contractimpl]
    impl SimpleVault {
        pub fn get_balance(env: Env, user: Address) -> i128 {
            env.storage().persistent().get(&user).unwrap_or(0)
        }

        pub fn deposit(env: Env, from: Address, amount: i128) {
            from.require_auth();
            let current: i128 = env.storage().persistent().get(&from).unwrap_or(0);
            env.storage().persistent().set(&from, &(current + amount));
        }
    }
  `;

  const overloadedContract = `
    #[contract]
    pub struct MegaContract;

    #[contractimpl]
    impl MegaContract {
        /// Monolithic entry point doing everything
        pub fn execute_all_operations(
            env: Env,
            admin: Address,
            user: Address,
            token_a: Address,
            token_b: Address,
            token_c: Address,
            amount: i128,
            mode: u32,
        ) {
            admin.require_auth();

            // Storage write 1, 2, 3, 4, 5, 6
            env.storage().instance().set(&symbol_short!("admin"), &admin);
            env.storage().instance().set(&symbol_short!("t_a"), &token_a);
            env.storage().instance().set(&symbol_short!("t_b"), &token_b);
            env.storage().persistent().set(&user, &amount);
            env.storage().persistent().set(&symbol_short!("mode"), &mode);
            env.storage().temporary().set(&symbol_short!("temp"), &100);

            // Storage reads
            let r1: i128 = env.storage().instance().get(&symbol_short!("t_a")).unwrap_or(0);
            let r2: i128 = env.storage().persistent().get(&user).unwrap_or(0);

            // Multiple external calls
            env.invoke_contract(&token_a, &symbol_short!("init"), &args);
            env.invoke_contract(&token_b, &symbol_short!("sync"), &args);
            let client_a = TokenClient::new(&env, &token_a);
            client_a.transfer(&admin, &user, &amount);
            let client_b = TokenClient::new(&env, &token_b);
            client_b.mint(&user, &amount);

            // Deep control flow & cyclomatic branching
            if mode == 1 {
                if amount > 1000 && r1 > 500 {
                    let client_c = TokenClient::new(&env, &token_c);
                    client_c.burn(&user, &50);
                } else if amount > 500 || r2 < 100 {
                    for i in 0..10 {
                        env.storage().persistent().set(&i, &true);
                    }
                }
            } else if mode == 2 {
                match mode {
                    2 => {
                        let _ = env.try_invoke_contract(&token_c, &symbol_short!("check"), &args);
                    },
                    _ => {},
                }
            } else {
                while mode > 0 {
                    break;
                }
            }
        }
    }
  `;

  describe('Complexity Measurement', () => {
    it('measures low complexity for clean and modular entry points', () => {
      const report = analyzeEntryPointComplexity(cleanContract);
      expect(report.totalEntryPoints).toBe(2);
      expect(report.overloadedCount).toBe(0);
      expect(report.findings).toHaveLength(0);

      const getBalance = report.entryPoints.find((e) => e.name === 'get_balance');
      expect(getBalance).toBeDefined();
      expect(getBalance!.metrics.cyclomaticComplexity).toBe(1);
      expect(getBalance!.metrics.linesOfCode).toBeLessThan(10);
      expect(getBalance!.isOverloaded).toBe(false);
    });

    it('measures high cyclomatic and cognitive complexity in branched entry points', () => {
      const report = analyzeEntryPointComplexity(overloadedContract);
      const fn = report.entryPoints.find((e) => e.name === 'execute_all_operations');
      expect(fn).toBeDefined();
      expect(fn!.metrics.cyclomaticComplexity).toBeGreaterThanOrEqual(10);
      expect(fn!.metrics.cognitiveComplexity).toBeGreaterThanOrEqual(10);
      expect(fn!.metrics.branchCount).toBeGreaterThan(3);
      expect(fn!.metrics.loopCount).toBeGreaterThan(1);
    });

    it('tracks lines of code and statement counts accurately', () => {
      const report = analyzeEntryPointComplexity(overloadedContract);
      const fn = report.entryPoints[0];
      expect(fn.metrics.linesOfCode).toBeGreaterThan(30);
      expect(fn.metrics.statementsCount).toBeGreaterThan(15);
    });
  });

  describe('Resource-Heavy Operations Tracking', () => {
    it('tracks storage operations count, reads, writes, and unique keys', () => {
      const report = analyzeEntryPointComplexity(overloadedContract);
      const fn = report.entryPoints[0];

      expect(fn.storage.totalStorageOperations).toBeGreaterThanOrEqual(8);
      expect(fn.storage.writesCount).toBeGreaterThanOrEqual(6);
      expect(fn.storage.readsCount).toBeGreaterThanOrEqual(2);
      expect(fn.storage.uniqueKeysCount).toBeGreaterThan(3);
      expect(fn.storage.storageInLoopsCount).toBeGreaterThan(0);
    });

    it('tracks external and cross-contract call volume', () => {
      const report = analyzeEntryPointComplexity(overloadedContract);
      const fn = report.entryPoints[0];

      expect(fn.externalCalls.totalCalls).toBeGreaterThanOrEqual(5);
      expect(fn.externalCalls.crossContractInvocations).toBeGreaterThanOrEqual(2);
      expect(fn.externalCalls.clientInvocations).toBeGreaterThanOrEqual(2);
      expect(fn.externalCalls.tokenTransfers).toBe(1);
      expect(fn.externalCalls.tokenStateMutations).toBeGreaterThanOrEqual(1);
      expect(fn.externalCalls.distinctTargetsCount).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Overloaded Entry Point Detection', () => {
    it('flags overloaded entry point with specific findings and recommendations', () => {
      const report = analyzeEntryPointComplexity(overloadedContract);
      expect(report.overloadedCount).toBe(1);

      const fn = report.overloadedEntryPoints[0];
      expect(fn.isOverloaded).toBe(true);
      expect(fn.overloadScore).toBeGreaterThanOrEqual(65);
      expect(fn.overloadReasons.length).toBeGreaterThanOrEqual(3);

      // Verify findings generated for multiple dimensions
      const storageFinding = fn.findings.find((f) => f.dimension === 'storage_operations');
      expect(storageFinding).toBeDefined();
      expect(storageFinding!.ruleId).toBe('soroban-overloaded-entry-point');

      const callFinding = fn.findings.find((f) => f.dimension === 'external_calls');
      expect(callFinding).toBeDefined();

      const paramFinding = fn.findings.find((f) => f.dimension === 'parameter_count');
      expect(paramFinding).toBeDefined();

      expect(fn.recommendations.length).toBeGreaterThan(0);
    });

    it('generates informative executive summary and aggregate metrics', () => {
      const report = analyzeEntryPointComplexity(overloadedContract);

      expect(report.summary).toContain('MegaContract');
      expect(report.summary).toContain('overloaded entry point');
      expect(report.summary).toContain('execute_all_operations');

      expect(report.aggregateMetrics.totalEntryPoints).toBe(1);
      expect(report.aggregateMetrics.overloadedCount).toBe(1);
      expect(report.aggregateMetrics.totalStorageOperations).toBeGreaterThan(0);
      expect(report.aggregateMetrics.totalExternalCalls).toBeGreaterThan(0);
    });
  });

  describe('Configurable Complexity Thresholds', () => {
    it('honors strict custom thresholds to flag smaller functions', () => {
      const strictThresholds = {
        maxCyclomaticComplexity: 2,
        maxStorageOperations: 1,
        maxLinesOfCode: 5,
        maxParameters: 2,
      };

      const report = analyzeEntryPointComplexity(cleanContract, 'contract.rs', strictThresholds);
      // deposit has 2 storage operations and 3 parameters, so under strict thresholds it should be flagged
      expect(report.overloadedCount).toBeGreaterThan(0);
      const depositFn = report.overloadedEntryPoints.find((e) => e.name === 'deposit');
      expect(depositFn).toBeDefined();
    });

    it('honors relaxed custom thresholds to suppress findings', () => {
      const relaxedThresholds = {
        maxCyclomaticComplexity: 100,
        maxCognitiveComplexity: 100,
        maxLinesOfCode: 500,
        maxStorageOperations: 100,
        maxStorageWrites: 100,
        maxExternalCalls: 100,
        maxParameters: 100,
        maxOverloadScore: 100,
      };

      const report = analyzeEntryPointComplexity(overloadedContract, 'contract.rs', relaxedThresholds);
      expect(report.overloadedCount).toBe(0);
      expect(report.findings).toHaveLength(0);
    });
  });

  describe('Edge Cases', () => {
    it('handles empty contracts gracefully', () => {
      const report = analyzeEntryPointComplexity('// Empty source');
      expect(report.entryPoints).toHaveLength(0);
      expect(report.overloadedCount).toBe(0);
      expect(report.summary).toContain('No entry points identified');
    });
  });
});
