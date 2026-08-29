/**
 * Issue #905 — Tests for Soroban Entry-Point Resource Profiler
 */

import { SorobanEntryPointProfiler, profileSorobanEntryPoints } from '../entry-point-profiler';

describe('SorobanEntryPointProfiler (#905)', () => {
  const sampleContract = `
    #![no_std]
    use soroban_sdk::{contract, contractimpl, Env, Address, Vec, Symbol, symbol_short, String};

    #[contract]
    pub struct LiquidityPool;

    #[contractimpl]
    impl LiquidityPool {
        pub fn init(env: Env, admin: Address, token_a: Address, token_b: Address) {
            admin.require_auth();
            env.storage().instance().set(&symbol_short!("admin"), &admin);
            env.storage().instance().set(&symbol_short!("token_a"), &token_a);
            env.storage().instance().set(&symbol_short!("token_b"), &token_b);
        }

        pub fn swap_batch(env: Env, from: Address, tokens: Vec<Address>, amounts: Vec<i128>) {
            from.require_auth();
            for token in tokens.iter() {
                for amount in amounts.iter() {
                    let _ = sha256(&env, &token);
                    env.storage().persistent().set(&token, &amount);
                }
            }
            env.invoke_contract(&token_a, &symbol_short!("swap"), &args);
        }

        pub fn get_reserves(env: Env) -> (i128, i128) {
            let r_a: i128 = env.storage().instance().get(&symbol_short!("res_a")).unwrap_or(0);
            let r_b: i128 = env.storage().instance().get(&symbol_short!("res_b")).unwrap_or(0);
            (r_a, r_b)
        }

        pub fn transfer_liquidity(env: Env, to: Address, amount: i128) {
            let client = TokenClient::new(&env, &token_a);
            client.transfer(&env.current_contract_address(), &to, &amount);
            let mut buf = Vec::with_capacity(&env, 1000);
            let _ = env.storage().persistent().set(&symbol_short!("last_tx"), &amount);
        }
    }
  `;

  it('extracts and profiles all entry points from contract', () => {
    const report = profileSorobanEntryPoints(sampleContract, 'liquidity_pool.rs');

    expect(report.contractName).toBe('LiquidityPool');
    expect(report.filePath).toBe('liquidity_pool.rs');
    expect(report.totalEntryPoints).toBe(4);
    expect(report.publicEntryPointsCount).toBeGreaterThanOrEqual(3);
    expect(report.rankedEntryPoints).toHaveLength(4);
  });

  it('correctly aggregates CPU impact', () => {
    const profiler = new SorobanEntryPointProfiler();
    const report = profiler.profile(sampleContract);

    const swapBatch = report.entryPoints.find((e) => e.name === 'swap_batch');
    expect(swapBatch).toBeDefined();
    expect(swapBatch!.cpu.nestedLoops).toBe(1);
    expect(swapBatch!.cpu.cryptoOperations).toBeGreaterThan(0);
    expect(swapBatch!.cpu.storageInLoops).toBe(1);
    expect(swapBatch!.cpu.score).toBeGreaterThanOrEqual(70);
    expect(swapBatch!.cpu.heavyOperations).toContain('nested-loops');
  });

  it('correctly aggregates Memory impact', () => {
    const report = profileSorobanEntryPoints(sampleContract);

    const transferLiq = report.entryPoints.find((e) => e.name === 'transfer_liquidity');
    expect(transferLiq).toBeDefined();
    expect(transferLiq!.memory.largeAllocations).toBe(1);
    expect(transferLiq!.memory.score).toBeGreaterThan(20);
    expect(transferLiq!.hotspots.some((h) => h.includes('large vector'))).toBe(true);
  });

  it('correctly aggregates Storage impact', () => {
    const report = profileSorobanEntryPoints(sampleContract);

    const initFn = report.entryPoints.find((e) => e.name === 'init');
    expect(initFn).toBeDefined();
    expect(initFn!.storage.instanceWrites).toBe(3);
    expect(initFn!.storage.writesCount).toBe(3);
    expect(initFn!.storage.score).toBeGreaterThan(30);

    const getReserves = report.entryPoints.find((e) => e.name === 'get_reserves');
    expect(getReserves).toBeDefined();
    expect(getReserves!.storage.instanceReads).toBe(2);
    expect(getReserves!.storage.writesCount).toBe(0);

    const swapBatch = report.entryPoints.find((e) => e.name === 'swap_batch');
    expect(swapBatch!.storage.storageInLoops).toBe(1);
  });

  it('correctly aggregates Contract-Call impact', () => {
    const report = profileSorobanEntryPoints(sampleContract);

    const swapBatch = report.entryPoints.find((e) => e.name === 'swap_batch');
    expect(swapBatch!.contractCalls.crossContractInvocations).toBeGreaterThan(0);

    const transferLiq = report.entryPoints.find((e) => e.name === 'transfer_liquidity');
    expect(transferLiq!.contractCalls.tokenTransfers).toBe(1);
    expect(transferLiq!.contractCalls.crossContractInvocations).toBe(1); // TokenClient::new
  });

  it('ranks entry points strictly in descending order of estimated cost', () => {
    const report = profileSorobanEntryPoints(sampleContract);

    expect(report.rankedEntryPoints.length).toBe(4);

    // Verify descending order
    for (let i = 1; i < report.rankedEntryPoints.length; i++) {
      const prev = report.rankedEntryPoints[i - 1];
      const curr = report.rankedEntryPoints[i];
      expect(prev.totalEstimatedCost).toBeGreaterThanOrEqual(curr.totalEstimatedCost);
      expect(prev.rank).toBe(i);
      expect(curr.rank).toBe(i + 1);
    }

    // swap_batch has nested loops, crypto, storage in loop, and invoke_contract -> should be #1 most expensive
    expect(report.mostExpensiveEntryPoint?.name).toBe('swap_batch');
    expect(report.rankedEntryPoints[0].name).toBe('swap_batch');
    expect(report.rankedEntryPoints[0].rank).toBe(1);
    expect(report.rankedEntryPoints[0].costTier).toBe('critical');

    // get_reserves only reads 2 instance variables -> should be lowest cost
    expect(report.leastExpensiveEntryPoint?.name).toBe('get_reserves');
    expect(report.leastExpensiveEntryPoint?.costTier).toBe('low');
  });

  it('computes accurate aggregate metrics across all entry points', () => {
    const report = profileSorobanEntryPoints(sampleContract);
    const { aggregateMetrics } = report;

    expect(aggregateMetrics.totalEstimatedCost).toBeGreaterThan(0);
    expect(aggregateMetrics.averageCost).toBeGreaterThan(0);
    expect(aggregateMetrics.totalStorageWrites).toBeGreaterThanOrEqual(4);
    expect(aggregateMetrics.totalStorageReads).toBeGreaterThanOrEqual(2);
    expect(aggregateMetrics.totalContractCalls).toBeGreaterThanOrEqual(2);
  });

  it('generates findings, hotspots, and actionable recommendations', () => {
    const report = profileSorobanEntryPoints(sampleContract);

    const swapBatch = report.rankedEntryPoints[0];
    expect(swapBatch.hotspots.length).toBeGreaterThan(0);
    expect(swapBatch.findings.length).toBeGreaterThan(0);
    expect(swapBatch.recommendations.length).toBeGreaterThan(0);

    const rules = swapBatch.findings.map((f) => f.ruleId);
    expect(rules).toContain('soroban-cpu-nested-loop');
    expect(rules).toContain('soroban-cpu-crypto-heavy');
    expect(rules).toContain('soroban-storage-in-loop');
  });

  it('handles lightweight / no-op contracts with zero false positives', () => {
    const noopContract = `
      #[contract]
      pub struct Minimal;

      #[contractimpl]
      impl Minimal {
          pub fn ping() -> bool {
              true
          }
      }
    `;

    const report = profileSorobanEntryPoints(noopContract, 'minimal.rs');
    expect(report.totalEntryPoints).toBe(1);
    const ping = report.rankedEntryPoints[0];
    expect(ping.name).toBe('ping');
    expect(ping.totalEstimatedCost).toBeLessThan(15);
    expect(ping.costTier).toBe('low');
    expect(ping.findings).toHaveLength(0);
    expect(report.summary).toContain('acceptable resource parameters');
  });

  it('respects custom weights and thresholds configuration', () => {
    const profiler = new SorobanEntryPointProfiler({
      weights: {
        cpu: 0.10,
        memory: 0.10,
        storage: 0.70,
        contractCalls: 0.10,
      },
      thresholds: {
        critical: 90,
        high: 60,
        medium: 30,
      },
    });

    const report = profiler.profile(sampleContract);
    expect(report.costThresholds.critical).toBe(90);
    expect(report.rankedEntryPoints).toBeDefined();
  });
});
