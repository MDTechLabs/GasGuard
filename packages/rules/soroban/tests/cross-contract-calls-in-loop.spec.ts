import { detectCrossContractCallsInsideLoops } from '../src/calls/cross-contract-calls-in-loop-rule';
import { analyzeCrossContractCallsInLoops } from '../../../analyzers/soroban/calls/cross-contract-calls-in-loop-analyzer';

describe('Detect Cross-Contract Calls Inside Soroban Loops (#876)', () => {
  const CONTRACT_WITH_LOOP_CALLS = `
    pub fn batch_distribute(env: Env, token: Address, recipients: Vec<Address>, amounts: Vec<i128>) {
      let client = token::Client::new(&env, &token);
      for i in 0..recipients.len() {
        let r = recipients.get(i).unwrap();
        let a = amounts.get(i).unwrap();
        client.transfer(&env.current_contract_address(), &r, &a);
      }
    }

    pub fn poll_oracles(env: Env, oracles: Vec<Address>) {
      for oracle in oracles.iter() {
        env.invoke_contract(&oracle, &Symbol::new(&env, "get_price"), Vec::new(&env));
      }
    }

    pub fn single_call(env: Env, token: Address, to: Address, amount: i128) {
      let client = token::Client::new(&env, &token);
      client.transfer(&env.current_contract_address(), &to, &amount);
    }
  `;

  test('detects token transfer calls inside for-loops', () => {
    const findings = detectCrossContractCallsInsideLoops(CONTRACT_WITH_LOOP_CALLS);

    expect(findings.length).toBe(2);
    expect(findings.some((f) => f.method === 'transfer')).toBe(true);
    expect(findings.some((f) => f.targetContract === 'token')).toBe(true);
  });

  test('detects invoke_contract calls inside collection iterations', () => {
    const findings = detectCrossContractCallsInsideLoops(CONTRACT_WITH_LOOP_CALLS);

    const oracleFinding = findings.find((f) => f.method === 'get_price' || f.method === 'invoke_contract');
    expect(oracleFinding).toBeDefined();
    expect(oracleFinding?.boundType).toBe('collection_iterator');
    expect(oracleFinding?.severity).toBe('high');
  });

  test('ignores contract calls outside loops', () => {
    const report = analyzeCrossContractCallsInLoops(CONTRACT_WITH_LOOP_CALLS);

    expect(report.affectedFunctions).toContain('batch_distribute');
    expect(report.affectedFunctions).toContain('poll_oracles');
    expect(report.affectedFunctions).not.toContain('single_call');
  });

  test('returns 0 findings on loop-free contracts', () => {
    const clean = `
      pub fn pay(env: Env, token: Address, to: Address, amount: i128) {
        let client = token::Client::new(&env, &token);
        client.transfer(&env.current_contract_address(), &to, &amount);
      }
    `;

    const findings = detectCrossContractCallsInsideLoops(clean);
    expect(findings.length).toBe(0);
  });
});
