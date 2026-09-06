import {
  analyzeUncheckedAuthParameters,
  UncheckedAuthParameterAnalyzer,
} from '../unchecked-auth-parameter-analyzer';

describe('UncheckedAuthParameterAnalyzer (Issue #897)', () => {
  const analyzer = new UncheckedAuthParameterAnalyzer();

  describe('1. Clearly unchecked authentication parameters (should flag)', () => {
    it('detects unchecked "from" address in token transfer', () => {
      const src = `
use soroban_sdk::{contractimpl, Address, Env};

pub struct VaultContract;

#[contractimpl]
impl VaultContract {
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        let client = token::Client::new(&env, &token);
        client.transfer(&from, &to, &amount);
    }
}
`;
      const report = analyzer.analyzeWithReport(src);
      expect(report.findings.length).toBeGreaterThanOrEqual(1);

      const finding = report.findings.find(
        (f) => f.functionName === 'transfer' && f.parameterName === 'from',
      );
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe('high');
      expect(finding?.rule).toBe('A4-unchecked-auth-param');
      expect(finding?.ruleId).toBe('soroban-unchecked-auth-parameter');
      expect(finding?.details.issueType).toBe('missing_validation');
      expect(report.metrics.uncheckedParameters).toBeGreaterThanOrEqual(1);
    });

    it('detects unchecked caller/admin in privileged storage mutation', () => {
      const src = `
use soroban_sdk::{contractimpl, Address, Env};

pub struct AdminContract;

#[contractimpl]
impl AdminContract {
    pub fn update_admin(env: Env, caller: Address, new_admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }
}
`;
      const findings = analyzeUncheckedAuthParameters(src).findings;
      const callerFinding = findings.find((f) => f.parameterName === 'caller');
      expect(callerFinding).toBeDefined();
      expect(callerFinding?.details.issueType).toBe('missing_validation');
    });

    it('detects unchecked signer in token burn', () => {
      const src = `
pub fn burn_tokens(env: Env, account: Address, amount: i128) {
    let client = token::Client::new(&env, &token_addr);
    client.burn(&account, &amount);
}
`;
      const findings = analyzer.analyze(src);
      expect(findings.some((f) => f.parameterName === 'account')).toBe(true);
    });
  });

  describe('2. Properly validated authentication parameters (should not flag)', () => {
    it('does not flag when require_auth precedes the transfer', () => {
      const src = `
use soroban_sdk::{contractimpl, Address, Env};

pub struct TokenContract;

#[contractimpl]
impl TokenContract {
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        let client = token::Client::new(&env, &token);
        client.transfer(&from, &to, &amount);
    }
}
`;
      const findings = analyzeUncheckedAuthParameters(src).findings;
      expect(findings.length).toBe(0);
    });

    it('does not flag when require_auth_for_args is used', () => {
      const src = `
pub fn transfer_with_context(env: Env, from: Address, to: Address, amount: i128) {
    from.require_auth_for_args((&to, &amount).into_val(&env));
    let client = token::Client::new(&env, &token);
    client.transfer(&from, &to, &amount);
}
`;
      const findings = analyzer.analyze(src);
      expect(findings.length).toBe(0);
    });

    it('recognizes equality assertion as valid authorization guard', () => {
      const src = `
pub fn set_fees(env: Env, admin: Address, new_fee: u32) {
    let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
    assert!(admin == stored_admin, "Unauthorized");
    env.storage().instance().set(&DataKey::Fee, &new_fee);
}
`;
      const findings = analyzer.analyze(src);
      expect(findings.length).toBe(0);
    });

    it('recognizes cryptographic signature verification as valid authorization', () => {
      const src = `
pub fn execute_signed(env: Env, signer: Address, sig: BytesN<64>, msg: Bytes) {
    env.crypto().ed25519_verify(&sig, &msg, &signer);
    env.storage().instance().set(&DataKey::Executed, &true);
}
`;
      const findings = analyzer.analyze(src);
      expect(findings.length).toBe(0);
    });
  });

  describe('3. Parameter checked ONLY AFTER use (order hazard, should flag)', () => {
    it('flags when transfer happens before require_auth call', () => {
      const src = `
use soroban_sdk::{contractimpl, Address, Env};

pub struct FlawedContract;

#[contractimpl]
impl FlawedContract {
    pub fn withdraw(env: Env, user: Address, to: Address, amount: i128) {
        let client = token::Client::new(&env, &token);
        client.transfer(&user, &to, &amount);
        user.require_auth();
    }
}
`;
      const report = analyzer.analyzeWithReport(src);
      expect(report.findings.length).toBe(1);

      const finding = report.findings[0];
      expect(finding.parameterName).toBe('user');
      expect(finding.details.issueType).toBe('checked_after_use');
      expect(finding.message).toMatch(/before being authorized/i);
      expect(finding.suggestion).toMatch(/Move the authorization check/i);
      expect(report.metrics.misorderedChecks).toBe(1);
    });

    it('flags when storage mutation happens before require_auth call', () => {
      const src = `
pub fn pause_protocol(env: Env, admin: Address) {
    env.storage().instance().set(&DataKey::Paused, &true);
    admin.require_auth();
}
`;
      const findings = analyzer.analyze(src);
      expect(findings.length).toBe(1);
      expect(findings[0].details.issueType).toBe('checked_after_use');
    });
  });

  describe('4. Destination parameters and non-authorizing roles (should not flag)', () => {
    it('does not flag the destination "to" parameter when "from" is authorized', () => {
      const src = `
pub fn pay_invoice(env: Env, from: Address, to: Address, amount: i128) {
    from.require_auth();
    let client = token::Client::new(&env, &token);
    client.transfer(&from, &to, &amount);
}
`;
      const findings = analyzer.analyze(src);
      expect(findings.length).toBe(0);
    });

    it('does not flag token contract address parameter used to create client', () => {
      const src = `
pub fn sweep(env: Env, owner: Address, token: Address, recipient: Address, amount: i128) {
    owner.require_auth();
    let client = token::Client::new(&env, &token);
    client.transfer(&owner, &recipient, &amount);
}
`;
      const findings = analyzer.analyze(src);
      expect(findings.length).toBe(0);
    });
  });

  describe('5. Excludes public read-only views and getters', () => {
    it('skips public view functions even with Address parameter', () => {
      const src = `
pub fn get_user_balance(env: Env, user: Address) -> i128 {
    env.storage().persistent().get(&user).unwrap_or(0)
}

pub fn view_allowance(env: Env, owner: Address, spender: Address) -> i128 {
    1000
}

#[view]
pub fn check_status(env: Env, account: Address) -> bool {
    true
}
`;
      const findings = analyzer.analyze(src);
      expect(findings.length).toBe(0);
    });
  });

  describe('6. Realistic multi-function Soroban contract fixture', () => {
    const REALISTIC_CONTRACT = `
use soroban_sdk::{contractimpl, Address, Env, BytesN};

pub struct DeFiVault;

#[contractimpl]
impl DeFiVault {
    // 1. Properly authorized deposit
    pub fn deposit(env: Env, from: Address, amount: i128) {
        from.require_auth();
        let client = token::Client::new(&env, &token);
        client.transfer(&from, &env.current_contract_address(), &amount);
        env.storage().persistent().set(&DataKey::Balance(from), &amount);
    }

    // 2. Vulnerability: Unchecked "caller" updating protocol fee
    pub fn set_fee(env: Env, caller: Address, fee_bps: u32) {
        env.storage().instance().set(&DataKey::Fee, &fee_bps);
    }

    // 3. Vulnerability: Order hazard - transfer occurs BEFORE require_auth
    pub fn emergency_withdraw(env: Env, user: Address, to: Address, amount: i128) {
        let client = token::Client::new(&env, &token);
        client.transfer(&user, &to, &amount);
        user.require_auth();
    }

    // 4. Properly authorized admin action with equality check
    pub fn set_admin(env: Env, admin: Address, new_admin: Address) {
        let current_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        assert_eq!(admin, current_admin);
        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }

    // 5. Read-only query (should not flag)
    pub fn get_fee(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Fee).unwrap_or(0)
    }
}
`;

    it('correctly audits the realistic contract fixture', () => {
      const report = analyzer.analyzeWithReport(REALISTIC_CONTRACT);

      expect(report.metrics.validatedParameters).toBe(2); // deposit (from), set_admin (admin)
      expect(report.metrics.uncheckedParameters).toBe(1); // set_fee (caller)
      expect(report.metrics.misorderedChecks).toBe(1); // emergency_withdraw (user)

      expect(report.findings).toHaveLength(2);

      const uncheckedFinding = report.findings.find((f) => f.functionName === 'set_fee');
      expect(uncheckedFinding).toBeDefined();
      expect(uncheckedFinding?.parameterName).toBe('caller');
      expect(uncheckedFinding?.details.issueType).toBe('missing_validation');

      const misorderedFinding = report.findings.find((f) => f.functionName === 'emergency_withdraw');
      expect(misorderedFinding).toBeDefined();
      expect(misorderedFinding?.parameterName).toBe('user');
      expect(misorderedFinding?.details.issueType).toBe('checked_after_use');
    });
  });
});
