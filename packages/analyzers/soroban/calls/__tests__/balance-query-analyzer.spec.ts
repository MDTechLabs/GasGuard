import {
  analyzeBalanceQueries,
  extractBalanceQueries,
  generateBalanceFindings,
  groupBalanceQueries,
} from '../balance-query-analyzer';

const REPEATED_QUERIES = `
pub fn quote(env: Env, token: Address, user: Address) -> i128 {
    let client = token::Client::new(&env, &token);
    let a = client.balance(&user);
    let b = client.balance(&user);
    let c = client.balance(&user);
    a + b + c
}
`;

const MUTATED_BETWEEN = `
pub fn settle(env: Env, token: Address, user: Address, treasury: Address) {
    let client = token::Client::new(&env, &token);
    let before = client.balance(&user);
    client.transfer(&user, &treasury, &fee);
    let after = client.balance(&user);
}
`;

const DIFFERENT_ACCOUNTS = `
pub fn compare(env: Env, token: Address, user: Address, treasury: Address) {
    let client = token::Client::new(&env, &token);
    let a = client.balance(&user);
    let b = client.balance(&treasury);
}
`;

const LOOPED_QUERY = `
pub fn distribute(env: Env, token: Address, vault: Address) {
    let client = token::Client::new(&env, &token);
    for _ in 0..rounds {
        let available = client.balance(&vault);
        pay_out(available);
    }
}
`;

describe('BalanceQueryAnalyzer', () => {
  describe('query extraction', () => {
    it('extracts balance reads with resolved asset and account inputs', () => {
      const queries = extractBalanceQueries(REPEATED_QUERIES);

      expect(queries).toHaveLength(3);
      expect(queries[0]).toMatchObject({
        fn: 'quote',
        asset: 'token',
        account: 'user',
        method: 'balance',
      });
    });

    it('extracts free-function balance reads keyed on the account argument', () => {
      const queries = extractBalanceQueries(`
        pub fn check(env: Env, user: Address) {
            let a = read_balance(&env, &user);
            let b = read_balance(&env, &user);
        }
      `);

      expect(queries).toHaveLength(2);
      expect(queries[0]).toMatchObject({ asset: 'self', account: 'user', method: 'read_balance' });
    });

    it('recognises balance_of and spendable_balance reads', () => {
      const queries = extractBalanceQueries(`
        pub fn check(env: Env, token: Address, user: Address) {
            let client = token::Client::new(&env, &token);
            let a = client.balance_of(&user);
            let b = client.spendable_balance(&user);
        }
      `);

      expect(queries.map((q) => q.method)).toEqual(['balance_of', 'spendable_balance']);
    });

    it('resolves the asset for the inline Client::new form', () => {
      const queries = extractBalanceQueries(`
        pub fn check(env: Env, user: Address) {
            let a = token::Client::new(&env, &usdc).balance(&user);
        }
      `);

      expect(queries[0].asset).toBe('usdc');
    });

    it('ignores balance reads in comments and string literals', () => {
      const queries = extractBalanceQueries(`
        pub fn documented(env: Env) {
            // let a = client.balance(&user);
            let note = "client.balance(&user)";
        }
      `);

      expect(queries).toHaveLength(0);
    });
  });

  describe('input comparison', () => {
    it('groups reads sharing the same asset and account', () => {
      const groups = groupBalanceQueries(REPEATED_QUERIES, extractBalanceQueries(REPEATED_QUERIES));

      expect(groups).toHaveLength(1);
      expect(groups[0]).toMatchObject({ asset: 'token', account: 'user', count: 3 });
    });

    it('keeps reads for different accounts in separate groups', () => {
      const groups = groupBalanceQueries(
        DIFFERENT_ACCOUNTS,
        extractBalanceQueries(DIFFERENT_ACCOUNTS),
      );

      expect(groups).toHaveLength(2);
      expect(groups.every((g) => g.count === 1)).toBe(true);
    });

    it('keeps reads for different assets in separate groups', () => {
      const source = `
        pub fn compare(env: Env, user: Address) {
            let a = token::Client::new(&env, &usdc).balance(&user);
            let b = token::Client::new(&env, &eurc).balance(&user);
        }
      `;
      const groups = groupBalanceQueries(source, extractBalanceQueries(source));

      expect(groups).toHaveLength(2);
    });

    it('treats clone()/borrow variants of the same account as identical inputs', () => {
      const source = `
        pub fn dup(env: Env, token: Address, user: Address) {
            let client = token::Client::new(&env, &token);
            let a = client.balance(&user);
            let b = client.balance(&user.clone());
        }
      `;
      const groups = groupBalanceQueries(source, extractBalanceQueries(source));

      expect(groups).toHaveLength(1);
      expect(groups[0].count).toBe(2);
    });
  });

  describe('safe reuse detection', () => {
    it('marks repeats with no intervening mutation as reusable', () => {
      const groups = groupBalanceQueries(REPEATED_QUERIES, extractBalanceQueries(REPEATED_QUERIES));

      expect(groups[0].safeToReuse).toBe(true);
      expect(groups[0].invalidatedBy).toBeUndefined();
    });

    it('marks repeats separated by a transfer as not reusable', () => {
      const groups = groupBalanceQueries(MUTATED_BETWEEN, extractBalanceQueries(MUTATED_BETWEEN));

      expect(groups[0].safeToReuse).toBe(false);
      expect(groups[0].invalidatedBy).toBe('token transfer');
      expect(groups[0].invalidatedAtLine).toBeGreaterThan(groups[0].lines[0]);
    });

    it('marks repeats separated by a mint as not reusable', () => {
      const source = `
        pub fn grant(env: Env, token: Address, user: Address) {
            let client = token::Client::new(&env, &token);
            let before = client.balance(&user);
            client.mint(&user, &reward);
            let after = client.balance(&user);
        }
      `;
      const groups = groupBalanceQueries(source, extractBalanceQueries(source));

      expect(groups[0].safeToReuse).toBe(false);
      expect(groups[0].invalidatedBy).toBe('token mint');
    });

    it('marks repeats separated by a storage write as not reusable', () => {
      const source = `
        pub fn touch(env: Env, user: Address) {
            let before = read_balance(&env, &user);
            env.storage().persistent().set(&key, &value);
            let after = read_balance(&env, &user);
        }
      `;
      const groups = groupBalanceQueries(source, extractBalanceQueries(source));

      expect(groups[0].safeToReuse).toBe(false);
      expect(groups[0].invalidatedBy).toBe('storage write');
    });

    it('marks reads on different conditional paths as not reusable', () => {
      const source = `
        pub fn branchy(env: Env, token: Address, user: Address) {
            let client = token::Client::new(&env, &token);
            if is_premium {
                let a = client.balance(&user);
            } else {
                let b = client.balance(&user);
            }
        }
      `;
      const groups = groupBalanceQueries(source, extractBalanceQueries(source));

      expect(groups[0].safeToReuse).toBe(false);
      expect(groups[0].invalidatedBy).toContain('conditional');
    });
  });

  describe('finding generation', () => {
    it('flags redundant reusable queries with a caching suggestion', () => {
      const { findings } = analyzeBalanceQueries(REPEATED_QUERIES);
      const redundant = findings.find((f) => f.ruleId === 'soroban-redundant-balance-query');

      expect(redundant).toBeDefined();
      expect(redundant!.safeToReuse).toBe(true);
      expect(redundant!.severity).toBe('medium');
      expect(redundant!.relatedLines).toHaveLength(2);
      expect(redundant!.suggestion).toContain('local variable');
    });

    it('downgrades and explains queries that must be re-read', () => {
      const { findings } = analyzeBalanceQueries(MUTATED_BETWEEN);
      const redundant = findings.find((f) => f.ruleId === 'soroban-redundant-balance-query');

      expect(redundant!.safeToReuse).toBe(false);
      expect(redundant!.severity).toBe('info');
      expect(redundant!.suggestion).toContain('Keep the re-read');
      expect(redundant!.suggestion).toContain('token transfer');
    });

    it('escalates severity as the query count grows', () => {
      const source = `
        pub fn hot(env: Env, token: Address, user: Address) {
            let client = token::Client::new(&env, &token);
            let a = client.balance(&user);
            let b = client.balance(&user);
            let c = client.balance(&user);
            let d = client.balance(&user);
        }
      `;
      const { findings } = analyzeBalanceQueries(source);

      expect(findings[0].severity).toBe('high');
    });

    it('flags a balance read inside a loop even when read only once', () => {
      const { findings } = analyzeBalanceQueries(LOOPED_QUERY);
      const inLoop = findings.find((f) => f.ruleId === 'soroban-balance-query-in-loop');

      expect(inLoop).toBeDefined();
      expect(inLoop!.severity).toBe('high');
      expect(inLoop!.suggestion).toContain('Hoist');
    });

    it('emits no findings when each input is queried once', () => {
      const report = analyzeBalanceQueries(DIFFERENT_ACCOUNTS);

      expect(report.queries).toHaveLength(2);
      expect(report.findings).toHaveLength(0);
    });

    it('keeps reads in different functions apart', () => {
      const source = `
        pub fn one(env: Env, token: Address, user: Address) {
            let client = token::Client::new(&env, &token);
            let a = client.balance(&user);
        }
        pub fn two(env: Env, token: Address, user: Address) {
            let client = token::Client::new(&env, &token);
            let b = client.balance(&user);
        }
      `;
      const report = analyzeBalanceQueries(source);

      expect(report.groups).toHaveLength(2);
      expect(report.findings).toHaveLength(0);
    });

    it('generates findings from pre-computed queries and groups', () => {
      const queries = extractBalanceQueries(REPEATED_QUERIES);
      const findings = generateBalanceFindings(
        queries,
        groupBalanceQueries(REPEATED_QUERIES, queries),
      );

      expect(findings).toHaveLength(1);
      expect(findings[0].account).toBe('user');
    });
  });

  describe('report metrics', () => {
    it('counts total, redundant and reusable queries', () => {
      const report = analyzeBalanceQueries(REPEATED_QUERIES);

      expect(report.metrics).toMatchObject({
        totalQueries: 3,
        uniqueInputs: 1,
        redundantQueries: 2,
        reusableQueries: 2,
      });
    });

    it('does not count non-reusable repeats as reusable', () => {
      const report = analyzeBalanceQueries(MUTATED_BETWEEN);

      expect(report.metrics.redundantQueries).toBe(1);
      expect(report.metrics.reusableQueries).toBe(0);
    });

    it('handles empty source without throwing', () => {
      const report = analyzeBalanceQueries('');

      expect(report.queries).toHaveLength(0);
      expect(report.findings).toHaveLength(0);
    });
  });
});
