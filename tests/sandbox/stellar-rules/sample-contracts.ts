/**
 * Sample Soroban Contracts for Rule Testing
 *
 * Provides a collection of sample Soroban contract source codes
 * used by the rule sandbox to test rules in isolation.
 */

export interface SampleContract {
  id: string;
  name: string;
  description: string;
  source: string;
  tags: string[];
}

const TOKEN_CONTRACT = `#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, vec, Env, Symbol, Vec, Address, String};

#[contract]
pub struct TokenContract;

#[contractimpl]
impl TokenContract {
    pub fn init(e: Env, admin: Address) {
        e.storage().instance().set(&symbol_short!("admin"), &admin);
    }

    pub fn transfer(e: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        let balance: i128 = e.storage().instance().get(&from).unwrap_or(0);
        if balance < amount {
            panic!("insufficient balance");
        }
        e.storage().instance().set(&from, &(balance - amount));
        let to_balance: i128 = e.storage().instance().get(&to).unwrap_or(0);
        e.storage().instance().set(&to, &(to_balance + amount));
        e.events().publish((symbol_short!("transfer"),), (from, to, amount));
    }

    pub fn balance(e: Env, addr: Address) -> i128 {
        e.storage().instance().get(&addr).unwrap_or(0)
    }
}
`;

const AUTH_CONTRACT = `#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, Env, Address, Symbol};

#[contract]
pub struct AuthContract;

#[contractimpl]
impl AuthContract {
    pub fn sensitive_action(e: Env, caller: Address) {
        // Missing require_auth() call
        let data = e.storage().instance().get::<_, i128>(&symbol_short!("data")).unwrap_or(0);
        e.storage().instance().set(&symbol_short!("data"), &(data + 1));
    }

    pub fn safe_action(e: Env, caller: Address) {
        caller.require_auth();
        let data = e.storage().instance().get::<_, i128>(&symbol_short!("data")).unwrap_or(0);
        e.storage().instance().set(&symbol_short!("data"), &(data - 1));
    }
}
`;

const STORAGE_CONTRACT = `#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, Env, Vec, String};

#[contract]
pub struct StorageContract;

#[contractimpl]
impl StorageContract {
    pub fn store(e: Env, key: String, value: String) {
        e.storage().instance().set(&key, &value);
    }

    pub fn read(e: Env, key: String) -> Option<String> {
        e.storage().instance().get(&key)
    }

    pub fn store_many(e: Env, count: u32) {
        for i in 0..count {
            let key = symbol_short!("key");
            e.storage().instance().set(&key, &i);
        }
    }

    pub fn read_all(e: Env) {
        let key = symbol_short!("data");
        for _ in 0..100 {
            let _: Option<i128> = e.storage().instance().get(&key);
        }
    }
}
`;

const EVENT_CONTRACT = `#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, Env, Address, Symbol, i128};

#[contract]
pub struct EventContract;

#[contractimpl]
impl EventContract {
    pub fn transfer_no_event(e: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        // State change but no event emission
        let bal: i128 = e.storage().instance().get(&from).unwrap_or(0);
        e.storage().instance().set(&from, &(bal - amount));
        let to_bal: i128 = e.storage().instance().get(&to).unwrap_or(0);
        e.storage().instance().set(&to, &(to_bal + amount));
    }

    pub fn transfer_with_event(e: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        let bal: i128 = e.storage().instance().get(&from).unwrap_or(0);
        e.storage().instance().set(&from, &(bal - amount));
        let to_bal: i128 = e.storage().instance().get(&to).unwrap_or(0);
        e.storage().instance().set(&to, &(to_bal + amount));
        e.events().publish((symbol_short!("transfer"),), (from, to, amount));
    }
}
`;

const MATH_CONTRACT = `#![no_std]
use soroban_sdk::{contract, contractimpl, Env, i128};

#[contract]
pub struct MathContract;

#[contractimpl]
impl MathContract {
    pub fn unchecked_add(e: Env, a: i128, b: i128) -> i128 {
        a + b
    }

    pub fn unchecked_sub(e: Env, a: i128, b: i128) -> i128 {
        a - b
    }

    pub fn unchecked_mul(e: Env, a: i128, b: i128) -> i128 {
        a * b
    }

    pub fn safe_divide(e: Env, a: i128, b: i128) -> i128 {
        if b == 0 {
            panic!("division by zero");
        }
        a / b
    }
}
`;

export const SAMPLE_CONTRACTS: Record<string, SampleContract> = {
  token: {
    id: 'sample-token',
    name: 'Basic Token Contract',
    description: 'A standard Soroban token contract with transfer and balance functions',
    source: TOKEN_CONTRACT,
    tags: ['token', 'transfer', 'storage', 'event'],
  },
  auth: {
    id: 'sample-auth',
    name: 'Authentication Test Contract',
    description: 'Contract with both authenticated and unauthenticated functions',
    source: AUTH_CONTRACT,
    tags: ['auth', 'access-control', 'security'],
  },
  storage: {
    id: 'sample-storage',
    name: 'Storage Patterns Contract',
    description: 'Contract demonstrating various storage access patterns',
    source: STORAGE_CONTRACT,
    tags: ['storage', 'gas', 'optimization'],
  },
  event: {
    id: 'sample-event',
    name: 'Event Emission Contract',
    description: 'Contract demonstrating event emission patterns and missing events',
    source: EVENT_CONTRACT,
    tags: ['event', 'state-change'],
  },
  math: {
    id: 'sample-math',
    name: 'Math Operations Contract',
    description: 'Contract with arithmetic operations for overflow testing',
    source: MATH_CONTRACT,
    tags: ['math', 'arithmetic', 'overflow'],
  },
};
