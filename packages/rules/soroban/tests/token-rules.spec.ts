import {
  analyzeBalanceQueryUsage,
  analyzeTransferGraph,
  detectConsolidatableTransfers,
  detectRedundantBalanceQueries,
  detectReusableBalanceQueries,
  detectUnnecessaryTransfers,
} from '../src/tokens';

const FEE_SPLITTER = `
pub fn collect_fees(env: Env, token: Address, user: Address, treasury: Address) {
    let client = token::Client::new(&env, &token);
    client.transfer(&user, &treasury, &protocol_fee);
    client.transfer(&user, &treasury, &relayer_fee);
}
`;

const AUTH_GUARDED = `
pub fn withdraw(env: Env, token: Address, user: Address, treasury: Address) {
    let client = token::Client::new(&env, &token);
    client.transfer(&user, &treasury, &first);
    user.require_auth();
    client.transfer(&user, &treasury, &second);
}
`;

const REPEATED_BALANCE_READS = `
pub fn quote(env: Env, token: Address, user: Address) -> i128 {
    let client = token::Client::new(&env, &token);
    let a = client.balance(&user);
    let b = client.balance(&user);
    a + b
}
`;

const BALANCE_AFTER_TRANSFER = `
pub fn settle(env: Env, token: Address, user: Address, treasury: Address) {
    let client = token::Client::new(&env, &token);
    let before = client.balance(&user);
    client.transfer(&user, &treasury, &fee);
    let after = client.balance(&user);
}
`;

describe('soroban token rules', () => {
  describe('soroban-unnecessary-token-transfer', () => {
    it('reports redundant transfers on the same edge', () => {
      const findings = detectUnnecessaryTransfers(FEE_SPLITTER);

      expect(findings).toHaveLength(1);
      expect(findings[0].ruleId).toBe('soroban-redundant-token-transfer');
      expect(findings[0].fn).toBe('collect_fees');
      expect(findings[0].token).toBe('token');
    });

    it('excludes security-sensitive transfers from consolidation candidates', () => {
      expect(detectUnnecessaryTransfers(AUTH_GUARDED)).toHaveLength(1);
      expect(detectConsolidatableTransfers(AUTH_GUARDED)).toHaveLength(0);
    });

    it('exposes the transfer graph alongside the findings', () => {
      const report = analyzeTransferGraph(FEE_SPLITTER);

      expect(report.transfers).toHaveLength(2);
      expect(report.edges).toHaveLength(1);
      expect(report.metrics.redundantTransfers).toBe(1);
    });

    it('returns no findings for a contract with a single transfer', () => {
      const findings = detectUnnecessaryTransfers(`
        pub fn pay(env: Env, token: Address, user: Address, treasury: Address) {
            let client = token::Client::new(&env, &token);
            client.transfer(&user, &treasury, &amount);
        }
      `);

      expect(findings).toHaveLength(0);
    });
  });

  describe('soroban-redundant-balance-query', () => {
    it('reports repeated balance reads with identical inputs', () => {
      const findings = detectRedundantBalanceQueries(REPEATED_BALANCE_READS);

      expect(findings).toHaveLength(1);
      expect(findings[0].ruleId).toBe('soroban-redundant-balance-query');
      expect(findings[0].account).toBe('user');
      expect(findings[0].safeToReuse).toBe(true);
    });

    it('excludes reads invalidated by an intervening transfer from reuse candidates', () => {
      expect(detectRedundantBalanceQueries(BALANCE_AFTER_TRANSFER)).toHaveLength(1);
      expect(detectReusableBalanceQueries(BALANCE_AFTER_TRANSFER)).toHaveLength(0);
    });

    it('exposes grouped query inputs alongside the findings', () => {
      const report = analyzeBalanceQueryUsage(REPEATED_BALANCE_READS);

      expect(report.queries).toHaveLength(2);
      expect(report.groups).toHaveLength(1);
      expect(report.metrics.reusableQueries).toBe(1);
    });

    it('returns no findings when each balance is read once', () => {
      const findings = detectRedundantBalanceQueries(`
        pub fn check(env: Env, token: Address, user: Address) {
            let client = token::Client::new(&env, &token);
            let a = client.balance(&user);
        }
      `);

      expect(findings).toHaveLength(0);
    });
  });
});
