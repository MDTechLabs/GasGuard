import { buildAuthorizationTree } from '../authorization-tree';

describe('Authorization Tree Analyzer (#917)', () => {
  const SINGLE_SIGNER = `
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
    }
  `;

  const MULTI_SIGNER = `
    pub fn transfer(env: Env, from: Address, admin: Address) {
        from.require_auth();
        admin.require_auth();
    }
  `;

  const NESTED_PARENT = `
    pub fn withdraw(env: Env, admin: Address, user: Address) {
        admin.authorize_as_parent();
        if is_admin {
            user.require_auth();
        }
    }
  `;

  const HELPER_CALL = `
    pub fn check_owner(env: Env, owner: Address) {
        owner.require_auth();
    }
    pub fn transfer(env: Env, owner: Address, to: Address) {
        check_owner(&env, &owner);
    }
  `;

  const NO_AUTH = `
    pub fn view_balance(env: Env, account: Address) -> i128 {
        storage::get(&account)
    }
  `;

  const MASKED = `
    pub fn transfer(env: Env, from: Address) {
        // from.require_auth();
        let s = "user.require_auth()";
        from.require_auth();
    }
  `;

  test('builds a tree with a single signer', () => {
    const report = buildAuthorizationTree(SINGLE_SIGNER);
    expect(report.roots).toHaveLength(1);
    expect(report.roots[0].functionName).toBe('transfer');
    expect(report.roots[0].hasAuth).toBe(true);
    expect(report.roots[0].children[0].signer).toMatch(/from/);
  });

  test('tracks multiple signers as relationships', () => {
    const report = buildAuthorizationTree(MULTI_SIGNER);
    expect(report.totalAuthNodes).toBe(2);
    expect(report.roots[0].authCalls).toBe(2);
  });

  test('represents authorize_as_parent nested checks', () => {
    const report = buildAuthorizationTree(NESTED_PARENT);
    const kinds = report.roots[0].children.flatMap((c) =>
      c.kind === 'conditional-branch' ? c.children.map((n) => n.kind) : [c.kind],
    );
    expect(kinds).toContain('nested-check');
    expect(report.totalAuthNodes).toBeGreaterThanOrEqual(2);
  });

  test('attributes helper auth through call edges', () => {
    const report = buildAuthorizationTree(HELPER_CALL);
    const transfer = report.roots.find((r) => r.functionName === 'transfer')!;
    expect(transfer.hasAuth).toBe(true);
    expect(transfer.children.some((c) => c.kind === 'cross-contract')).toBe(true);
  });

  test('masks comments and string literals', () => {
    const report = buildAuthorizationTree(MASKED);
    expect(report.totalAuthNodes).toBe(1);
  });

  test('exposes unprotected entrypoints', () => {
    const report = buildAuthorizationTree(NO_AUTH);
    expect(report.unprotectedEntrypoints).toContain('view_balance');
  });

  test('exposes a serializable tree shape', () => {
    const report = buildAuthorizationTree(SINGLE_SIGNER);
    const json = JSON.parse(JSON.stringify(report));
    expect(json.roots[0].id).toBeDefined();
    expect(json.roots[0].children[0].signer).toBeDefined();
    expect(json).toMatchSnapshot();
  });
});
