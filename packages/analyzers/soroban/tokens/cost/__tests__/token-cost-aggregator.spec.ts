import {
  aggregateTokenCosts,
  extractTokenCalls,
  groupCostsByOperation,
  groupCostsByAsset,
} from '../token-cost-aggregator';

describe('Soroban Token Call Cost Aggregator (#873)', () => {
  const SAMPLE_CONTRACT = `
    pub fn batch_payout(env: Env, usdc: Address, xlm: Address, to: Address, amount: i128) {
      let usdc_client = token::Client::new(&env, &usdc);
      let xlm_client = token::Client::new(&env, &xlm);

      let b1 = usdc_client.balance(&to);
      usdc_client.transfer(&env.current_contract_address(), &to, &amount);
      let b2 = usdc_client.balance(&to);

      xlm_client.transfer(&env.current_contract_address(), &to, &amount);
      xlm_client.approve(&to, &to, &amount, &1000);
    }

    pub fn loop_transfers(env: Env, token_addr: Address, recipients: Vec<Address>) {
      let client = token::Client::new(&env, &token_addr);
      for r in recipients.iter() {
        client.transfer(&env.current_contract_address(), &r, &100);
      }
    }
  `;

  test('extractTokenCalls identifies token operations and resolves assets', () => {
    const calls = extractTokenCalls(SAMPLE_CONTRACT);
    expect(calls.length).toBe(6);

    const methods = calls.map((c) => c.method);
    expect(methods).toContain('balance');
    expect(methods).toContain('transfer');
    expect(methods).toContain('approve');

    const inLoopCall = calls.find((c) => c.fn === 'loop_transfers');
    expect(inLoopCall?.inLoop).toBe(true);
    expect(inLoopCall?.resourceCost.cpuInstructions).toBeGreaterThan(120_000);
  });

  test('groupCostsByOperation aggregates resources and ranks dominant operations', () => {
    const calls = extractTokenCalls(SAMPLE_CONTRACT);
    const totalCpu = calls.reduce((s, c) => s + c.resourceCost.cpuInstructions, 0);
    const groups = groupCostsByOperation(calls, totalCpu);

    expect(groups.length).toBe(3); // transfer, balance, approve
    expect(groups[0].operation).toBe('transfer');
    expect(groups[0].count).toBe(3);
    expect(groups[0].percentageOfTotalCpu).toBeGreaterThan(50);
  });

  test('groupCostsByAsset groups calls by token asset identifier', () => {
    const calls = extractTokenCalls(SAMPLE_CONTRACT);
    const assetGroups = groupCostsByAsset(calls);

    expect(assetGroups.some((g) => g.token === 'usdc')).toBe(true);
    expect(assetGroups.some((g) => g.token === 'xlm')).toBe(true);
    expect(assetGroups.some((g) => g.token === 'token_addr')).toBe(true);

    const usdcGroup = assetGroups.find((g) => g.token === 'usdc');
    expect(usdcGroup?.count).toBe(3); // 2 balances, 1 transfer
    expect(usdcGroup?.dominantOperation).toBe('balance');
  });

  test('aggregateTokenCosts produces comprehensive report and recommendations', () => {
    const report = aggregateTokenCosts(SAMPLE_CONTRACT);

    expect(report.totalCalls).toBe(6);
    expect(report.dominantOperation).toBe('transfer');
    expect(report.totalEstimatedCpuInstructions).toBeGreaterThan(0);
    expect(report.totalEstimatedMemoryBytes).toBeGreaterThan(0);
    expect(report.totalEstimatedStorageReadBytes).toBeGreaterThan(0);

    // Verify recommendations
    expect(report.recommendations.some((r) => r.includes('inside loops'))).toBe(true);
    expect(report.recommendations.some((r) => r.includes('balance queries'))).toBe(true);
    expect(report.recommendations.some((r) => r.includes('transfers'))).toBe(true);
  });

  test('returns empty report for contracts without token calls', () => {
    const report = aggregateTokenCosts(`
      pub fn add(a: u32, b: u32) -> u32 {
        a + b
      }
    `);

    expect(report.totalCalls).toBe(0);
    expect(report.dominantOperation).toBeNull();
    expect(report.dominantAsset).toBeNull();
    expect(report.recommendations.length).toBe(0);
  });
});
