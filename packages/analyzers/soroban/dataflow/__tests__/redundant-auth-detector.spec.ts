import { detectRedundantAuth } from '../redundant-auth-detector';

describe('Detect Unnecessary Soroban Authentication Checks (Issue #896)', () => {
  test('detects redundant auth checks in sequential execution context', () => {
    const source = `
use soroban_sdk::{contractimpl, Address, Env};

pub struct Vault;

#[contractimpl]
impl Vault {
    pub fn deposit(env: Env, owner: Address, amount: i128) {
        owner.require_auth();
        // some operations
        owner.require_auth(); // redundant
    }
}
`;
    const report = detectRedundantAuth(source);

    expect(report.metrics.totalRedundantChecks).toBe(1);
    expect(report.findings[0].target).toBe('owner');
    expect(report.findings[0].severity).toBe('medium');
  });

  test('does not flag auth checks on mutually exclusive branches', () => {
    const source = `
use soroban_sdk::{contractimpl, Address, Env};

pub struct Vault;

#[contractimpl]
impl Vault {
    pub fn conditional_auth(env: Env, user: Address, mode: u32) {
        if mode == 1 {
            user.require_auth();
        } else {
            user.require_auth();
        }
    }
}
`;
    const report = detectRedundantAuth(source);

    expect(report.metrics.totalRedundantChecks).toBe(0);
  });
});
