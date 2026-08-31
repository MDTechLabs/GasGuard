/**
 * Issue #903 — Tests for Soroban Contract Entry-Point Analyzer
 */

import {
  SorobanEntryPointAnalyzer,
  analyzeEntryPoints,
} from '../entry-point-analyzer';

describe('SorobanEntryPointAnalyzer (#903)', () => {
  const sampleContract = `
    #![no_std]
    use soroban_sdk::{contract, contractimpl, Env, Address, Vec, Map, Symbol, symbol_short, String, Result};

    #[contract]
    pub struct LiquidityVault;

    #[contractimpl]
    impl LiquidityVault {
        /// Initializes the liquidity vault with admin and primary tokens
        pub fn init(env: Env, admin: Address, token_a: Address, token_b: Address) {
            admin.require_auth();
            env.storage().instance().set(&symbol_short!("admin"), &admin);
            env.storage().instance().set(&symbol_short!("token_a"), &token_a);
            env.storage().instance().set(&symbol_short!("token_b"), &token_b);
        }

        /// Performs batch swap operation across multiple recipients
        pub fn swap_batch(env: Env, from: Address, tokens: Vec<Address>, amounts: Vec<i128>) {
            from.require_auth();
            for token in tokens.iter() {
                for amount in amounts.iter() {
                    env.storage().persistent().set(&token, &amount);
                }
            }
            env.invoke_contract(&token_a, &symbol_short!("swap"), &args);
        }

        /// Queries current pool reserves (read-only)
        pub fn get_reserves(env: Env) -> (i128, i128) {
            let r_a: i128 = env.storage().instance().get(&symbol_short!("r_a")).unwrap_or(0);
            let r_b: i128 = env.storage().instance().get(&symbol_short!("r_b")).unwrap_or(0);
            (r_a, r_b)
        }

        /// Transfers tokens using TokenClient
        pub fn transfer_liquidity(env: Env, sender: Address, recipient: Address, amount: i128) {
            sender.require_auth_for_args((recipient.clone(), amount).into_val(&env));
            let client = TokenClient::new(&env, &token_a);
            client.transfer(&sender, &recipient, &amount);
        }

        /// Unprotected state mutation: modifies storage without require_auth
        pub fn emergency_override(env: Env, new_admin: Address) {
            env.storage().instance().set(&symbol_short!("admin"), &new_admin);
        }

        /// Anti-pattern: require_auth inside loop
        pub fn process_whitelist(env: Env, accounts: Vec<Address>) {
            for account in accounts.iter() {
                account.require_auth();
                env.storage().persistent().set(&account, &true);
            }
        }

        /// Helper function internal to contract logic
        fn internal_calculate_fee(amount: i128) -> i128 {
            amount * 3 / 1000
        }
    }
  `;

  describe('Entry Point Identification', () => {
    it('identifies public entry points, constructors, and internal functions', () => {
      const report = analyzeEntryPoints(sampleContract);

      expect(report.contractName).toBe('LiquidityVault');
      expect(report.entryPoints.length).toBe(7);

      const initFn = report.entryPoints.find((e) => e.name === 'init');
      expect(initFn).toBeDefined();
      expect(initFn!.visibility).toBe('constructor');
      expect(initFn!.isExported).toBe(true);

      const swapBatch = report.entryPoints.find((e) => e.name === 'swap_batch');
      expect(swapBatch).toBeDefined();
      expect(swapBatch!.visibility).toBe('public');
      expect(swapBatch!.isExported).toBe(true);

      const getReserves = report.entryPoints.find((e) => e.name === 'get_reserves');
      expect(getReserves).toBeDefined();
      expect(getReserves!.isReadOnly).toBe(true);

      const internalHelper = report.entryPoints.find((e) => e.name === 'internal_calculate_fee');
      expect(internalHelper).toBeDefined();
      expect(internalHelper!.visibility).toBe('internal');
      expect(internalHelper!.isExported).toBe(false);
    });

    it('identifies entry points from trait implementations', () => {
      const traitContract = `
        pub trait VaultTrait {
            fn deposit(env: Env, from: Address, amount: i128);
            fn withdraw(env: Env, to: Address, amount: i128);
        }

        #[contractimpl]
        impl VaultTrait for MyVault {
            pub fn deposit(env: Env, from: Address, amount: i128) {
                from.require_auth();
                env.storage().persistent().set(&from, &amount);
            }

            pub fn withdraw(env: Env, to: Address, amount: i128) {
                to.require_auth();
            }
        }
      `;

      const report = analyzeEntryPoints(traitContract);
      expect(report.publicEntryPoints.length).toBe(2);
      expect(report.entryPoints[0].traitName).toBe('VaultTrait');
      expect(report.entryPoints[0].contractName).toBe('MyVault');
    });

    it('identifies standalone pub fn functions', () => {
      const standalone = `
        pub fn external_entry(env: Env, user: Address) {
            user.require_auth();
        }
        fn private_helper() {}
      `;

      const report = analyzeEntryPoints(standalone);
      const ext = report.entryPoints.find((e) => e.name === 'external_entry');
      expect(ext).toBeDefined();
      expect(ext!.visibility).toBe('public');
      expect(ext!.isExported).toBe(true);
    });
  });

  describe('Parameter Extraction', () => {
    it('extracts parameters with types, flags, and doc comments', () => {
      const report = analyzeEntryPoints(sampleContract);

      const initFn = report.entryPoints.find((e) => e.name === 'init');
      expect(initFn).toBeDefined();
      expect(initFn!.docComment).toContain('Initializes the liquidity vault');
      expect(initFn!.parameters.length).toBe(4);

      const envParam = initFn!.parameters.find((p) => p.name === 'env');
      expect(envParam).toBeDefined();
      expect(envParam!.isEnv).toBe(true);
      expect(envParam!.type).toBe('Env');

      const adminParam = initFn!.parameters.find((p) => p.name === 'admin');
      expect(adminParam).toBeDefined();
      expect(adminParam!.isAddress).toBe(true);
      expect(adminParam!.isAuthParam).toBe(true);

      const tokenAParam = initFn!.parameters.find((p) => p.name === 'token_a');
      expect(tokenAParam).toBeDefined();
      expect(tokenAParam!.isAddress).toBe(true);
    });

    it('extracts collection parameters and return types', () => {
      const report = analyzeEntryPoints(sampleContract);

      const swapBatch = report.entryPoints.find((e) => e.name === 'swap_batch');
      expect(swapBatch).toBeDefined();
      expect(swapBatch!.parameters.length).toBe(4);

      const tokensParam = swapBatch!.parameters.find((p) => p.name === 'tokens');
      expect(tokensParam).toBeDefined();
      expect(tokensParam!.isCollection).toBe(true);
      expect(tokensParam!.type).toBe('Vec<Address>');

      const getReserves = report.entryPoints.find((e) => e.name === 'get_reserves');
      expect(getReserves).toBeDefined();
      expect(getReserves!.returnType).toBe('(i128, i128)');
    });

    it('extracts mutable and reference parameters correctly', () => {
      const src = `
        #[contractimpl]
        impl StateContract {
            pub fn mutate_vector(env: Env, mut list: Vec<i128>, item: &Address) {
                list.push_back(100);
            }
        }
      `;
      const report = analyzeEntryPoints(src);
      const fn = report.entryPoints.find((e) => e.name === 'mutate_vector');
      expect(fn).toBeDefined();
      expect(fn!.parameters.length).toBe(3);

      const listParam = fn!.parameters.find((p) => p.name === 'list');
      expect(listParam!.isMutable).toBe(true);

      const itemParam = fn!.parameters.find((p) => p.name === 'item');
      expect(itemParam!.isReference).toBe(true);
    });
  });

  describe('Authorization Path Tracking', () => {
    it('tracks require_auth and maps authorized parameters', () => {
      const report = analyzeEntryPoints(sampleContract);

      const initFn = report.entryPoints.find((e) => e.name === 'init');
      expect(initFn!.authorization.hasAuthCheck).toBe(true);
      expect(initFn!.authorization.checks.length).toBe(1);
      expect(initFn!.authorization.checks[0].type).toBe('require_auth');
      expect(initFn!.authorization.checks[0].target).toBe('admin');
      expect(initFn!.authorization.authorizedParams).toContain('admin');
    });

    it('tracks require_auth_for_args and extracts arguments', () => {
      const report = analyzeEntryPoints(sampleContract);

      const transferFn = report.entryPoints.find((e) => e.name === 'transfer_liquidity');
      expect(transferFn!.authorization.hasAuthCheck).toBe(true);
      expect(transferFn!.authorization.checks[0].type).toBe('require_auth_for_args');
      expect(transferFn!.authorization.checks[0].target).toBe('sender');
    });

    it('detects unprotected state-mutating entry points', () => {
      const report = analyzeEntryPoints(sampleContract);

      const overrideFn = report.entryPoints.find((e) => e.name === 'emergency_override');
      expect(overrideFn).toBeDefined();
      expect(overrideFn!.isStateMutating).toBe(true);
      expect(overrideFn!.authorization.isMissingRequiredAuth).toBe(true);
      expect(overrideFn!.authorization.unauthorizedAddressParams).toContain('new_admin');

      const finding = overrideFn!.findings.find((f) => f.ruleId === 'soroban-unprotected-entry-point');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('critical');
    });

    it('detects authorization check inside loops', () => {
      const report = analyzeEntryPoints(sampleContract);

      const whitelistFn = report.entryPoints.find((e) => e.name === 'process_whitelist');
      expect(whitelistFn).toBeDefined();
      expect(whitelistFn!.authorization.hasLoopAuth).toBe(true);
      expect(whitelistFn!.authorization.checks[0].isInLoop).toBe(true);

      const loopAuthFinding = whitelistFn!.findings.find((f) => f.ruleId === 'soroban-entry-point-auth-in-loop');
      expect(loopAuthFinding).toBeDefined();
      expect(loopAuthFinding!.severity).toBe('medium');
    });

    it('detects redundant authorization checks', () => {
      const src = `
        #[contractimpl]
        impl RedundantAuthContract {
            pub fn multi_check(env: Env, caller: Address) {
                caller.require_auth();
                caller.require_auth_for_args((100,).into_val(&env));
            }
        }
      `;
      const report = analyzeEntryPoints(src);
      const fn = report.entryPoints[0];
      expect(fn.authorization.hasRedundantAuth).toBe(true);
      const finding = fn.findings.find((f) => f.ruleId === 'soroban-entry-point-redundant-auth');
      expect(finding).toBeDefined();
    });
  });

  describe('Storage Access Tracking', () => {
    it('tracks instance storage reads and writes with keys', () => {
      const report = analyzeEntryPoints(sampleContract);

      const initFn = report.entryPoints.find((e) => e.name === 'init');
      expect(initFn!.storage.instanceWrites).toBe(3);
      expect(initFn!.storage.writesCount).toBe(3);
      expect(initFn!.storage.uniqueKeysWritten.length).toBe(3);
      expect(initFn!.storage.isStateMutating).toBe(true);

      const getReserves = report.entryPoints.find((e) => e.name === 'get_reserves');
      expect(getReserves!.storage.instanceReads).toBe(2);
      expect(getReserves!.storage.writesCount).toBe(0);
      expect(getReserves!.storage.isStateMutating).toBe(false);
    });

    it('detects storage operations inside loops', () => {
      const report = analyzeEntryPoints(sampleContract);

      const swapBatch = report.entryPoints.find((e) => e.name === 'swap_batch');
      expect(swapBatch!.storage.storageInLoopsCount).toBeGreaterThan(0);
      expect(swapBatch!.storage.persistentWrites).toBe(1);

      const loopFinding = swapBatch!.findings.find((f) => f.ruleId === 'soroban-entry-point-storage-in-loop');
      expect(loopFinding).toBeDefined();
      expect(loopFinding!.severity).toBe('high');
    });

    it('tracks TTL extensions on instance and persistent storage', () => {
      const src = `
        #[contractimpl]
        impl TtlContract {
            pub fn keep_alive(env: Env) {
                env.storage().instance().extend_ttl(100, 200);
                env.storage().persistent().extend_ttl(&key, 100, 200);
            }
        }
      `;
      const report = analyzeEntryPoints(src);
      const fn = report.entryPoints[0];
      expect(fn.storage.ttlExtensionsCount).toBe(2);
      expect(fn.isStateMutating).toBe(true);
    });
  });

  describe('External Call Tracking', () => {
    it('tracks cross-contract invocations', () => {
      const report = analyzeEntryPoints(sampleContract);

      const swapBatch = report.entryPoints.find((e) => e.name === 'swap_batch');
      expect(swapBatch!.externalCalls.crossContractInvocations).toBe(1);
      expect(swapBatch!.externalCalls.targetsInvoked).toContain('token_a');
    });

    it('tracks TokenClient and typed Client calls', () => {
      const report = analyzeEntryPoints(sampleContract);

      const transferFn = report.entryPoints.find((e) => e.name === 'transfer_liquidity');
      expect(transferFn!.externalCalls.clientInvocations).toBe(1);
      expect(transferFn!.externalCalls.tokenTransfers).toBe(1);
      expect(transferFn!.externalCalls.totalCalls).toBe(2);
    });

    it('detects external calls inside loops', () => {
      const src = `
        #[contractimpl]
        impl LoopCaller {
            pub fn distribute(env: Env, recipients: Vec<Address>, token: Address) {
                let client = TokenClient::new(&env, &token);
                for r in recipients.iter() {
                    client.transfer(&env.current_contract_address(), &r, &100);
                }
            }
        }
      `;
      const report = analyzeEntryPoints(src);
      const fn = report.entryPoints[0];
      expect(fn.externalCalls.callsInLoopsCount).toBeGreaterThan(0);

      const loopCallFinding = fn.findings.find((f) => f.ruleId === 'soroban-entry-point-call-in-loop');
      expect(loopCallFinding).toBeDefined();
      expect(loopCallFinding!.severity).toBe('high');
    });
  });

  describe('Aggregate Metrics and Reports', () => {
    it('generates accurate metrics and executive summary', () => {
      const report = analyzeEntryPoints(sampleContract);

      expect(report.metrics.totalEntryPoints).toBe(7);
      expect(report.metrics.publicEntryPointsCount).toBe(6);
      expect(report.metrics.constructorCount).toBe(1);
      expect(report.metrics.internalFunctionsCount).toBe(1);
      expect(report.metrics.unprotectedMutatingCount).toBe(1);
      expect(report.metrics.storageInLoopsCount).toBeGreaterThan(0);

      expect(report.summary).toContain('LiquidityVault');
      expect(report.summary).toContain('CRITICAL');
      expect(report.findings.length).toBeGreaterThan(0);
    });

    it('handles empty contract source gracefully', () => {
      const report = analyzeEntryPoints('// empty contract');
      expect(report.entryPoints).toHaveLength(0);
      expect(report.publicEntryPoints).toHaveLength(0);
      expect(report.metrics.totalEntryPoints).toBe(0);
      expect(report.summary).toContain('No entry points detected');
    });
  });
});
