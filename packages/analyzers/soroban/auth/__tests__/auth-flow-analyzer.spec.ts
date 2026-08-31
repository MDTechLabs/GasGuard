import { analyzeAuthFlow } from '../auth-flow-analyzer';

describe('Soroban Authentication Flow Analyzer (Issue #895)', () => {
  test('detects authentication operations and tracks execution paths', () => {
    const source = `
use soroban_sdk::{contractimpl, Address, Env};

pub struct TokenContract;

#[contractimpl]
impl TokenContract {
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        let _ = amount;
    }
}
`;
    const report = analyzeAuthFlow(source);

    expect(report.metrics.totalAuthChecks).toBe(1);
    expect(report.operations[0]).toEqual({
      caller: 'transfer',
      line: expect.any(Number),
      targetAddress: 'from',
      method: 'require_auth',
      inLoop: false,
      inBranch: false,
    });
    expect(report.findings.length).toBe(0);
  });

  test('reports complex flows with repeated authentication and auth inside loops', () => {
    const source = `
use soroban_sdk::{contractimpl, Address, Env, Vec};

pub struct BatchContract;

#[contractimpl]
impl BatchContract {
    pub fn batch_process(env: Env, admin: Address, recipients: Vec<Address>) {
        admin.require_auth();
        admin.require_auth();

        for recipient in recipients.iter() {
            recipient.require_auth();
        }
    }
}
`;
    const report = analyzeAuthFlow(source);

    expect(report.metrics.totalAuthChecks).toBe(3);
    expect(report.metrics.complexFlowFunctions).toBe(1);
    expect(report.findings.length).toBe(1);
    expect(report.findings[0].severity).toBe('high');
  });
});
