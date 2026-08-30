import {
  extractTokenFunctionSignatures,
  checkTokenInterface,
} from '../token-interface-checker';

describe('Soroban Token Interface Compatibility Checker (#922)', () => {
  const FULL_TOKEN_CONTRACT = `
    pub fn balance(env: Env, account: Address) -> i128 {
        storage::get(&account)
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) -> i128 {
        // transfer logic
        amount
    }

    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) -> i128 {
        amount
    }

    pub fn approve(env: Env, owner: Address, spender: Address, amount: i128, live_until_ledger: u32) -> i128 {
        amount
    }

    pub fn allowance(env: Env, owner: Address, spender: Address) -> i128 {
        0
    }

    pub fn approve_from(env: Env, from: Address, owner: Address, spender: Address, amount: i128, live_until_ledger: u32) -> i128 {
        amount
    }
  `;

  const PARTIAL_TOKEN_CONTRACT = `
    pub fn balance(env: Env, account: Address) -> i128 {
        0
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) -> i128 {
        amount
    }
  `;

  const NON_TOKEN_CONTRACT = `
    pub fn initialize(env: Env, admin: Address) {
        storage::set(&admin);
    }

    pub fn mint(env: Env, to: Address, amount: i128) {
        // mint logic
    }
  `;

  const CONTRACT_WITH_EXTRA = `
    pub fn balance(env: Env, account: Address) -> i128 { 0 }
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) -> i128 { amount }
    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) -> i128 { amount }
    pub fn approve(env: Env, owner: Address, spender: Address, amount: i128, live_until_ledger: u32) -> i128 { amount }
    pub fn allowance(env: Env, owner: Address, spender: Address) -> i128 { 0 }
    pub fn approve_from(env: Env, from: Address, owner: Address, spender: Address, amount: i128, live_until_ledger: u32) -> i128 { amount }
    pub fn custom_burn(env: Env, from: Address, amount: i128) { }
  `;

  test('extractTokenFunctionSignatures finds all pub fn signatures', () => {
    const sigs = extractTokenFunctionSignatures(FULL_TOKEN_CONTRACT);
    expect(sigs.length).toBe(6);
    expect(sigs.map((s) => s.name)).toContain('balance');
    expect(sigs.map((s) => s.name)).toContain('transfer');
    expect(sigs.map((s) => s.name)).toContain('transfer_from');
    expect(sigs.map((s) => s.name)).toContain('approve');
    expect(sigs.map((s) => s.name)).toContain('allowance');
    expect(sigs.map((s) => s.name)).toContain('approve_from');
  });

  test('extractTokenFunctionSignatures strips env parameter', () => {
    const sigs = extractTokenFunctionSignatures(FULL_TOKEN_CONTRACT);
    const balance = sigs.find((s) => s.name === 'balance');
    expect(balance).toBeDefined();
    expect(balance!.params).toEqual(['Address']);
  });

  test('checkTokenInterface reports full compatibility for complete token', () => {
    const result = checkTokenInterface(FULL_TOKEN_CONTRACT);
    expect(result.isFullyCompatible).toBe(true);
    expect(result.missingMethods).toEqual([]);
    expect(result.coveragePercent).toBe(100);
    expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  test('checkTokenInterface detects missing methods', () => {
    const result = checkTokenInterface(PARTIAL_TOKEN_CONTRACT);
    expect(result.isFullyCompatible).toBe(false);
    expect(result.missingMethods).toContain('transfer_from');
    expect(result.missingMethods).toContain('approve');
    expect(result.missingMethods).toContain('allowance');
    expect(result.missingMethods).toContain('approve_from');
    expect(result.coveragePercent).toBe(33);
  });

  test('checkTokenInterface detects no standard methods in non-token contract', () => {
    const result = checkTokenInterface(NON_TOKEN_CONTRACT);
    expect(result.isFullyCompatible).toBe(false);
    expect(result.missingMethods).toEqual(expect.arrayContaining([
      'balance', 'transfer', 'transfer_from', 'approve', 'allowance', 'approve_from',
    ]));
    expect(result.coveragePercent).toBe(0);
    expect(result.issues.some((i) => i.severity === 'error')).toBe(true);
  });

  test('checkTokenInterface reports extra non-standard methods as info', () => {
    const result = checkTokenInterface(CONTRACT_WITH_EXTRA);
    expect(result.isFullyCompatible).toBe(true);
    expect(result.extraMethods).toContain('custom_burn');
    expect(result.issues.some((i) => i.severity === 'info' && i.message.includes('custom_burn'))).toBe(true);
  });

  test('checkTokenInterface returns deterministic expected methods list', () => {
    const r1 = checkTokenInterface(FULL_TOKEN_CONTRACT);
    const r2 = checkTokenInterface(PARTIAL_TOKEN_CONTRACT);
    expect(r1.expectedMethods).toEqual(r2.expectedMethods);
    expect(r1.expectedMethods).toEqual([
      'balance', 'transfer', 'transfer_from', 'approve', 'allowance', 'approve_from',
    ]);
  });
});
