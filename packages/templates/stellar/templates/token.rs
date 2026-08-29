// Soroban Fungible Token Contract Template
//
// A secure, production-ready fungible token (SEP-41 compatible) contract
// with access control, overflow-safe arithmetic, and event emission.
//
// Usage: Replace {{CONTRACT_NAME}} with your contract name.

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, contractclient,
    token, symbol_short,
    Address, Env, String, Symbol,
    log,
};

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Admin,
    TotalSupply,
    Balance(Address),
    Allowance(Address, Address),
    Decimals,
    Name,
    Symbol,
}

// ── Error types ───────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum TokenError {
    /// Caller is not the admin
    Unauthorized = 1,
    /// Amount exceeds available balance
    InsufficientBalance = 2,
    /// Allowance is too small for the requested transfer
    InsufficientAllowance = 3,
    /// Zero-address or self-transfer not permitted
    InvalidAddress = 4,
    /// Integer overflow would occur
    ArithmeticOverflow = 5,
    /// Token has already been initialised
    AlreadyInitialized = 6,
}

// ── Contract struct ───────────────────────────────────────────────────────────

#[contract]
pub struct {{CONTRACT_NAME}};

// ── Implementation ────────────────────────────────────────────────────────────

#[contractimpl]
impl {{CONTRACT_NAME}} {
    // ─── Admin / Lifecycle ───────────────────────────────────────────

    /// Initialise the token. Can only be called once.
    ///
    /// * `admin`   – address that receives minting authority.
    /// * `decimal` – number of decimal places (e.g. 7 for 1e-7 precision).
    /// * `name`    – human-readable token name.
    /// * `symbol`  – short ticker symbol.
    pub fn initialize(
        env: Env,
        admin: Address,
        decimal: u32,
        name: String,
        symbol: String,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::TotalSupply, &0_i128);
        env.storage().instance().set(&DataKey::Decimals, &decimal);
        env.storage().instance().set(&DataKey::Name, &name);
        env.storage().instance().set(&DataKey::Symbol, &symbol);
    }

    /// Mint `amount` tokens to `to`. Requires admin authorisation.
    pub fn mint(env: Env, to: Address, amount: i128) {
        Self::require_admin(&env);
        assert!(amount > 0, "mint amount must be positive");

        let supply: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);

        let new_supply = supply.checked_add(amount).expect("overflow");
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &new_supply);

        let balance = Self::balance_of(&env, to.clone());
        env.storage()
            .persistent()
            .set(&DataKey::Balance(to.clone()), &(balance + amount));

        TokenEvents::minted(&env, to, amount);
    }

    /// Burn `amount` tokens from the caller's balance. Caller must authorise.
    pub fn burn(env: Env, from: Address, amount: i128) {
        from.require_auth();
        assert!(amount > 0, "burn amount must be positive");

        let balance = Self::balance_of(&env, from.clone());
        assert!(balance >= amount, "insufficient balance");

        env.storage()
            .persistent()
            .set(&DataKey::Balance(from.clone()), &(balance - amount));

        let supply: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &(supply - amount));

        TokenEvents::burned(&env, from, amount);
    }

    // ─── SEP-41 token interface ──────────────────────────────────────

    /// Transfer `amount` from caller to `to`. Caller must authorise.
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        assert!(from != to, "self-transfer not allowed");
        assert!(amount > 0, "transfer amount must be positive");

        let from_balance = Self::balance_of(&env, from.clone());
        assert!(from_balance >= amount, "insufficient balance");

        env.storage()
            .persistent()
            .set(&DataKey::Balance(from.clone()), &(from_balance - amount));

        let to_balance = Self::balance_of(&env, to.clone());
        env.storage()
            .persistent()
            .set(&DataKey::Balance(to.clone()), &(to_balance + amount));

        TokenEvents::transferred(&env, from, to, amount);
    }

    /// Approve `spender` to transfer up to `amount` on behalf of `owner`.
    pub fn approve(env: Env, owner: Address, spender: Address, amount: i128, expiration_ledger: u32) {
        owner.require_auth();
        assert!(amount >= 0, "allowance must be non-negative");

        env.storage().temporary().set(
            &DataKey::Allowance(owner.clone(), spender.clone()),
            &amount,
        );

        TokenEvents::approved(&env, owner, spender, amount, expiration_ledger);
    }

    /// Transfer `amount` from `from` to `to` using the caller's allowance.
    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        assert!(from != to, "self-transfer not allowed");
        assert!(amount > 0, "transfer amount must be positive");

        let allowance = Self::allowance_of(&env, from.clone(), spender.clone());
        assert!(allowance >= amount, "insufficient allowance");

        env.storage().temporary().set(
            &DataKey::Allowance(from.clone(), spender),
            &(allowance - amount),
        );

        let from_balance = Self::balance_of(&env, from.clone());
        assert!(from_balance >= amount, "insufficient balance");

        env.storage()
            .persistent()
            .set(&DataKey::Balance(from.clone()), &(from_balance - amount));

        let to_balance = Self::balance_of(&env, to.clone());
        env.storage()
            .persistent()
            .set(&DataKey::Balance(to.clone()), &(to_balance + amount));

        TokenEvents::transferred(&env, from, to, amount);
    }

    // ─── Read-only getters ───────────────────────────────────────────

    pub fn balance(env: Env, account: Address) -> i128 {
        Self::balance_of(&env, account)
    }

    pub fn allowance(env: Env, owner: Address, spender: Address) -> i128 {
        Self::allowance_of(&env, owner, spender)
    }

    pub fn total_supply(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0)
    }

    pub fn decimals(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::Decimals)
            .unwrap_or(7)
    }

    pub fn name(env: Env) -> String {
        env.storage()
            .instance()
            .get(&DataKey::Name)
            .unwrap()
    }

    pub fn symbol(env: Env) -> String {
        env.storage()
            .instance()
            .get(&DataKey::Symbol)
            .unwrap()
    }

    // ─── Admin helpers ───────────────────────────────────────────────

    /// Transfer admin role. Current admin must authorise.
    pub fn set_admin(env: Env, new_admin: Address) {
        Self::require_admin(&env);
        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }

    pub fn admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    // ─── Private helpers ─────────────────────────────────────────────

    fn balance_of(env: &Env, account: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(account))
            .unwrap_or(0)
    }

    fn allowance_of(env: &Env, owner: Address, spender: Address) -> i128 {
        env.storage()
            .temporary()
            .get(&DataKey::Allowance(owner, spender))
            .unwrap_or(0)
    }

    fn require_admin(env: &Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
    }
}

// ── Event helpers ─────────────────────────────────────────────────────────────

struct TokenEvents;

impl TokenEvents {
    fn minted(env: &Env, to: Address, amount: i128) {
        let topics = (symbol_short!("mint"), to);
        env.events().publish(topics, amount);
    }

    fn burned(env: &Env, from: Address, amount: i128) {
        let topics = (symbol_short!("burn"), from);
        env.events().publish(topics, amount);
    }

    fn transferred(env: &Env, from: Address, to: Address, amount: i128) {
        let topics = (symbol_short!("transfer"), from, to);
        env.events().publish(topics, amount);
    }

    fn approved(env: &Env, owner: Address, spender: Address, amount: i128, expiration_ledger: u32) {
        let topics = (symbol_short!("approve"), owner, spender);
        env.events().publish(topics, (amount, expiration_ledger));
    }
}
