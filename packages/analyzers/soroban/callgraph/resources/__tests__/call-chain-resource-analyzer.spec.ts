import {
  analyzeCallChainResources,
  extractFunctionInvocations,
  buildCallChains,
} from '../call-chain-resource-analyzer';
import { extractFunctions, maskNonCode } from '../../../common/source-utils';

describe('Soroban Call Chain Resource Analyzer (#877)', () => {
  const SAMPLE_CONTRACT = `
    pub fn process_order(env: Env, token: Address, recipient: Address, amount: i128) {
      validate_account(&env, &recipient);
      settle_payment(&env, &token, &recipient, amount);
    }

    fn validate_account(env: &Env, recipient: &Address) {
      check_kyc(env, recipient);
    }

    fn check_kyc(env: &Env, recipient: &Address) {
      // internal validation
      let valid = true;
    }

    fn settle_payment(env: &Env, token: &Address, recipient: &Address, amount: i128) {
      let client = token::Client::new(env, token);
      client.transfer(&env.current_contract_address(), recipient, &amount);
    }
  `;

  test('extractFunctionInvocations detects both internal and external calls', () => {
    const masked = maskNonCode(SAMPLE_CONTRACT);
    const functions = extractFunctions(masked, SAMPLE_CONTRACT);
    const invocations = extractFunctionInvocations(SAMPLE_CONTRACT, functions);

    expect(invocations.length).toBeGreaterThan(3);
    expect(invocations.some((i) => i.caller === 'process_order' && i.callee === 'validate_account')).toBe(true);
    expect(invocations.some((i) => i.caller === 'settle_payment' && i.isExternal)).toBe(true);
  });

  test('buildCallChains traces multi-hop downstream invocation paths', () => {
    const masked = maskNonCode(SAMPLE_CONTRACT);
    const functions = extractFunctions(masked, SAMPLE_CONTRACT);
    const invocations = extractFunctionInvocations(SAMPLE_CONTRACT, functions);
    const chains = buildCallChains(invocations, functions);

    expect(chains.length).toBeGreaterThan(0);

    // Verify deep chain: process_order -> validate_account -> check_kyc
    const kycChain = chains.find((c) => c.path.includes('validate_account') && c.path.includes('check_kyc'));
    expect(kycChain).toBeDefined();
    expect(kycChain?.depth).toBe(3);

    // Verify external payment chain: process_order -> settle_payment -> external
    const paymentChain = chains.find((c) => c.path.includes('settle_payment') && c.hasExternalHops);
    expect(paymentChain).toBeDefined();
    expect(paymentChain?.totalCost.cpuInstructions).toBeGreaterThan(100_000);
  });

  test('analyzeCallChainResources generates comprehensive report and detects expensive downstream calls', () => {
    const report = analyzeCallChainResources(SAMPLE_CONTRACT);

    expect(report.chains.length).toBeGreaterThan(0);
    expect(report.maxChainDepth).toBeGreaterThanOrEqual(3);
    expect(report.totalAggregatedCpu).toBeGreaterThan(0);
    expect(report.summary).toMatch(/dominant path/i);

    // Findings should flag deep or expensive chains
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.findings.some((f) => f.entryFunction === 'process_order')).toBe(true);
  });

  test('handles contracts without calls cleanly', () => {
    const simple = `
      pub fn ping() -> u32 {
        42
      }
    `;
    const report = analyzeCallChainResources(simple);
    expect(report.chains.length).toBe(0);
    expect(report.findings.length).toBe(0);
    expect(report.summary).toContain('No complex call chains');
  });
});
