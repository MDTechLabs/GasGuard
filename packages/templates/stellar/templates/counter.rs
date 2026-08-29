// Soroban Counter Contract Template
//
// A minimal, secure counter contract demonstrating admin-gated mutation,
// instance storage, and overflow-safe arithmetic.
//
// Usage: Replace {{CONTRACT_NAME}} with your contract name.

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env};

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Admin,
    Counter,
    Step,
}

// ── Contract struct ───────────────────────────────────────────────────────────

#[contract]
pub struct {{CONTRACT_NAME}};

// ── Implementation ────────────────────────────────────────────────────────────

#[contractimpl]
impl {{CONTRACT_NAME}} {
    /// Initialise the counter. Can only be called once.
    ///
    /// * `admin` – address authorised to increment/decrement/reset.
    /// * `step`  – amount added/subtracted on each increment/decrement (≥ 1).
    pub fn initialize(env: Env, admin: Address, step: u64) {
        assert!(
            !env.storage().instance().has(&DataKey::Admin),
            "already initialized"
        );
        assert!(step >= 1, "step must be at least 1");

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Counter, &0_u64);
        env.storage().instance().set(&DataKey::Step, &step);
    }

    /// Increment the counter by `step`. Requires admin authorisation.
    pub fn increment(env: Env) -> u64 {
        Self::require_admin(&env);

        let value: u64 = env
            .storage()
            .instance()
            .get(&DataKey::Counter)
            .unwrap_or(0);
        let step: u64 = env
            .storage()
            .instance()
            .get(&DataKey::Step)
            .unwrap_or(1);

        let new_value = value.checked_add(step).expect("counter overflow");
        env.storage()
            .instance()
            .set(&DataKey::Counter, &new_value);

        env.events()
            .publish((symbol_short!("increment"),), new_value);

        new_value
    }

    /// Decrement the counter by `step`. Panics if the result would underflow.
    /// Requires admin authorisation.
    pub fn decrement(env: Env) -> u64 {
        Self::require_admin(&env);

        let value: u64 = env
            .storage()
            .instance()
            .get(&DataKey::Counter)
            .unwrap_or(0);
        let step: u64 = env
            .storage()
            .instance()
            .get(&DataKey::Step)
            .unwrap_or(1);

        let new_value = value.checked_sub(step).expect("counter underflow");
        env.storage()
            .instance()
            .set(&DataKey::Counter, &new_value);

        env.events()
            .publish((symbol_short!("decrement"),), new_value);

        new_value
    }

    /// Reset the counter to zero. Requires admin authorisation.
    pub fn reset(env: Env) {
        Self::require_admin(&env);
        env.storage().instance().set(&DataKey::Counter, &0_u64);
        env.events().publish((symbol_short!("reset"),), 0_u64);
    }

    /// Read the current counter value (anyone can call).
    pub fn get(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::Counter)
            .unwrap_or(0)
    }

    /// Read the current step value.
    pub fn get_step(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::Step)
            .unwrap_or(1)
    }

    /// Update the step. Requires admin authorisation.
    pub fn set_step(env: Env, step: u64) {
        Self::require_admin(&env);
        assert!(step >= 1, "step must be at least 1");
        env.storage().instance().set(&DataKey::Step, &step);
    }

    /// Transfer admin role. Current admin must authorise.
    pub fn set_admin(env: Env, new_admin: Address) {
        Self::require_admin(&env);
        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }

    /// Return the current admin address.
    pub fn admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    // ─── Private helpers ─────────────────────────────────────────────

    fn require_admin(env: &Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
    }
}
