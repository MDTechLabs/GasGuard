import {
  analyzeTokenTransfers,
  buildTransferEdges,
  extractTransfers,
  traceTransferPaths,
} from '../token-transfer-analyzer';

const REPEATED_TRANSFERS = `
pub fn pay_fees(env: Env, token: Address, user: Address, treasury: Address) {
    let client = token::Client::new(&env, &token);
    client.transfer(&user, &treasury, &base_fee);
    client.transfer(&user, &treasury, &priority_fee);
    client.transfer(&user, &treasury, &tip);
}
`;

const RELAY_CHAIN = `
pub fn route(env: Env, token: Address, user: Address, escrow: Address, merchant: Address) {
    let client = token::Client::new(&env, &token);
    client.transfer(&user, &escrow, &amount);
    client.transfer(&escrow, &merchant, &amount);
}
`;

const GUARDED_TRANSFERS = `
pub fn withdraw(env: Env, token: Address, user: Address, treasury: Address) {
    let client = token::Client::new(&env, &token);
    client.transfer(&user, &treasury, &first);
    user.require_auth();
    client.transfer(&user, &treasury, &second);
}
`;

const BRANCHED_TRANSFERS = `
pub fn settle(env: Env, token: Address, user: Address, treasury: Address) {
    let client = token::Client::new(&env, &token);
    if is_premium {
        client.transfer(&user, &treasury, &premium_fee);
    } else {
        client.transfer(&user, &treasury, &standard_fee);
    }
}
`;

const LOOPED_TRANSFERS = `
pub fn payout(env: Env, token: Address, vault: Address, winner: Address) {
    let client = token::Client::new(&env, &token);
    for _ in 0..rounds {
        client.transfer(&vault, &winner, &share);
    }
    client.transfer(&vault, &winner, &bonus);
}
`;

const CLEAN = `
pub fn single_payment(env: Env, token: Address, user: Address, treasury: Address) {
    let client = token::Client::new(&env, &token);
    client.transfer(&user, &treasury, &amount);
}
`;

describe('TokenTransferAnalyzer', () => {
  describe('transfer extraction', () => {
    it('extracts transfer sites with resolved token, source and destination', () => {
      const transfers = extractTransfers(REPEATED_TRANSFERS);

      expect(transfers).toHaveLength(3);
      expect(transfers[0]).toMatchObject({
        fn: 'pay_fees',
        token: 'token',
        method: 'transfer',
        from: 'user',
        to: 'treasury',
        amount: 'base_fee',
      });
    });

    it('resolves the token for the inline Client::new form', () => {
      const transfers = extractTransfers(`
        pub fn tip(env: Env) {
            token::Client::new(&env, &usdc).transfer(&payer, &author, &amount);
        }
      `);

      expect(transfers).toHaveLength(1);
      expect(transfers[0].token).toBe('usdc');
      expect(transfers[0].to).toBe('author');
    });

    it('reads the from/to slots of transfer_from correctly', () => {
      const transfers = extractTransfers(`
        pub fn pull(env: Env) {
            let client = token::Client::new(&env, &token);
            client.transfer_from(&spender, &owner, &vault, &amount);
        }
      `);

      expect(transfers[0]).toMatchObject({ from: 'owner', to: 'vault', amount: 'amount' });
    });

    it('normalizes clone()/borrow noise so identical destinations match', () => {
      const transfers = extractTransfers(`
        pub fn twice(env: Env) {
            let client = token::Client::new(&env, &token);
            client.transfer(&user, &treasury.clone(), &a);
            client.transfer(&user.clone(), &treasury, &b);
        }
      `);

      expect(transfers[0].to).toBe(transfers[1].to);
      expect(transfers[0].from).toBe(transfers[1].from);
    });

    it('ignores transfers appearing in comments or string literals', () => {
      const transfers = extractTransfers(`
        pub fn documented(env: Env) {
            // client.transfer(&user, &treasury, &amount);
            let note = "client.transfer(&user, &treasury, &amount)";
        }
      `);

      expect(transfers).toHaveLength(0);
    });
  });

  describe('transfer paths', () => {
    it('builds directed edges and counts repeats', () => {
      const edges = buildTransferEdges(extractTransfers(REPEATED_TRANSFERS));

      expect(edges).toHaveLength(1);
      expect(edges[0]).toMatchObject({ from: 'user', to: 'treasury', count: 3 });
      expect(edges[0].lines).toHaveLength(3);
    });

    it('traces multi-hop transfer paths through an intermediate holder', () => {
      const paths = traceTransferPaths(extractTransfers(RELAY_CHAIN));

      expect(paths).toHaveLength(1);
      expect(paths[0].hops).toEqual(['user', 'escrow', 'merchant']);
    });

    it('does not link hops across different tokens', () => {
      const paths = traceTransferPaths(
        extractTransfers(`
          pub fn mixed(env: Env) {
              let a = token::Client::new(&env, &usdc);
              let b = token::Client::new(&env, &eurc);
              a.transfer(&user, &escrow, &amount);
              b.transfer(&escrow, &merchant, &amount);
          }
        `),
      );

      expect(paths).toHaveLength(0);
    });
  });

  describe('redundant transfer detection', () => {
    it('flags repeated transfers on the same edge and suggests consolidation', () => {
      const { findings } = analyzeTokenTransfers(REPEATED_TRANSFERS);
      const redundant = findings.find((f) => f.ruleId === 'soroban-redundant-token-transfer');

      expect(redundant).toBeDefined();
      expect(redundant!.severity).toBe('high');
      expect(redundant!.preserved).toBe(false);
      expect(redundant!.relatedLines).toHaveLength(2);
      expect(redundant!.suggestion).toContain('single transfer');
      expect(redundant!.suggestion).toContain('base_fee + priority_fee + tip');
    });

    it('suggests a direct transfer when funds relay through an intermediate', () => {
      const { findings } = analyzeTokenTransfers(RELAY_CHAIN);
      const relay = findings.find((f) => f.ruleId === 'soroban-intermediate-token-transfer');

      expect(relay).toBeDefined();
      expect(relay!.preserved).toBe(false);
      expect(relay!.message).toContain('user → escrow → merchant');
      expect(relay!.suggestion).toContain("directly from 'user' to 'merchant'");
    });

    it('preserves a relay whose hops move different amounts', () => {
      const { findings } = analyzeTokenTransfers(`
        pub fn skim(env: Env) {
            let client = token::Client::new(&env, &token);
            client.transfer(&user, &escrow, &gross);
            client.transfer(&escrow, &merchant, &net);
        }
      `);
      const relay = findings.find((f) => f.ruleId === 'soroban-intermediate-token-transfer');

      expect(relay!.preserved).toBe(true);
      expect(relay!.severity).toBe('info');
    });

    it('flags self-transfers as removable', () => {
      const { findings } = analyzeTokenTransfers(`
        pub fn noop(env: Env) {
            let client = token::Client::new(&env, &token);
            client.transfer(&user, &user, &amount);
        }
      `);

      const self = findings.find((f) => f.ruleId === 'soroban-self-token-transfer');
      expect(self).toBeDefined();
      expect(self!.preserved).toBe(false);
    });

    it('flags hard-coded zero-amount transfers', () => {
      const { findings } = analyzeTokenTransfers(`
        pub fn ping(env: Env) {
            let client = token::Client::new(&env, &token);
            client.transfer(&user, &treasury, &0i128);
        }
      `);

      expect(findings.some((f) => f.ruleId === 'soroban-zero-token-transfer')).toBe(true);
    });

    it('reports nothing for a contract with a single transfer', () => {
      const report = analyzeTokenTransfers(CLEAN);

      expect(report.transfers).toHaveLength(1);
      expect(report.findings).toHaveLength(0);
    });
  });

  describe('security-sensitive preservation', () => {
    it('preserves transfers separated by an authorization check', () => {
      const { findings } = analyzeTokenTransfers(GUARDED_TRANSFERS);
      const redundant = findings.find((f) => f.ruleId === 'soroban-redundant-token-transfer');

      expect(redundant!.preserved).toBe(true);
      expect(redundant!.severity).toBe('info');
      expect(redundant!.preservedReason).toContain('authorization');
      expect(redundant!.suggestion).not.toContain('single transfer');
    });

    it('preserves transfers on mutually exclusive branches', () => {
      const { findings } = analyzeTokenTransfers(BRANCHED_TRANSFERS);
      const redundant = findings.find((f) => f.ruleId === 'soroban-redundant-token-transfer');

      expect(redundant!.preserved).toBe(true);
      expect(redundant!.preservedReason).toContain('conditional');
    });

    it('preserves transfers whose repeat count is loop-driven', () => {
      const { findings } = analyzeTokenTransfers(LOOPED_TRANSFERS);
      const redundant = findings.find((f) => f.ruleId === 'soroban-redundant-token-transfer');

      expect(redundant!.preserved).toBe(true);
      expect(redundant!.preservedReason).toContain('loop');
    });

    it('still consolidates repeats separated by a non-security statement', () => {
      const { findings } = analyzeTokenTransfers(`
        pub fn batch(env: Env) {
            let client = token::Client::new(&env, &token);
            client.transfer(&user, &treasury, &a);
            log("paid part one");
            client.transfer(&user, &treasury, &b);
        }
      `);
      const redundant = findings.find((f) => f.ruleId === 'soroban-redundant-token-transfer');

      expect(redundant!.preserved).toBe(false);
    });
  });

  describe('report metrics', () => {
    it('summarizes transfer counts and opportunities', () => {
      const report = analyzeTokenTransfers(REPEATED_TRANSFERS);

      expect(report.metrics.totalTransfers).toBe(3);
      expect(report.metrics.uniqueEdges).toBe(1);
      expect(report.metrics.redundantTransfers).toBe(2);
      expect(report.metrics.consolidationOpportunities).toBeGreaterThan(0);
    });

    it('counts preserved findings separately', () => {
      const report = analyzeTokenTransfers(GUARDED_TRANSFERS);

      expect(report.metrics.preservedTransfers).toBeGreaterThan(0);
      expect(report.metrics.consolidationOpportunities).toBe(0);
    });

    it('keeps transfers in separate functions apart', () => {
      const report = analyzeTokenTransfers(`
        pub fn one(env: Env) {
            let client = token::Client::new(&env, &token);
            client.transfer(&user, &treasury, &amount);
        }
        pub fn two(env: Env) {
            let client = token::Client::new(&env, &token);
            client.transfer(&user, &treasury, &amount);
        }
      `);

      expect(report.edges).toHaveLength(2);
      expect(report.findings).toHaveLength(0);
    });

    it('handles empty source without throwing', () => {
      const report = analyzeTokenTransfers('');
      expect(report.transfers).toHaveLength(0);
      expect(report.findings).toHaveLength(0);
    });
  });
});
