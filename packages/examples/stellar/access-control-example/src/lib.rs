#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contracttype]
pub enum DataKey {
    Admin,
    Role(Address),
}

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum Role {
    Admin,
    User,
    None,
}

#[contract]
pub struct AccessControlContract;

#[contractimpl]
impl AccessControlContract {
    pub fn initialize(env: Env, admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Role(admin), &Role::Admin);
    }

    pub fn grant_role(env: Env, caller: Address, account: Address) {
        caller.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        assert!(caller == stored_admin, "Only admin can grant roles");
        env.storage().instance().set(&DataKey::Role(account), &Role::User);
    }

    pub fn get_role(env: Env, account: Address) -> Role {
        env.storage().instance().get(&DataKey::Role(account)).unwrap_or(Role::None)
    }

    pub fn restricted_action(env: Env, caller: Address) {
        caller.require_auth();
        let role: Role = env.storage().instance().get(&DataKey::Role(caller)).unwrap_or(Role::None);
        assert!(role != Role::None, "Access denied: no role assigned");
    }
}
