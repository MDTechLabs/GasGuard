//! Example Soroban contract WITHOUT network validation
//! This contract should trigger the NetworkValidationRule

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol, Map};

#[contracttype]
pub struct TokenWithoutNetworkValidation {
    pub admin: Address,
    pub total_supply: u64,
    pub balances: Map<Address, u64>,
}

#[contractimpl]
impl TokenWithoutNetworkValidation {
    /// Constructor - Missing network validation
    pub fn initialize(env: Env, admin: Address, initial_supply: u64) -> Self {
        // ❌ No network validation
        // This contract could behave differently on mainnet vs testnet
        
        let mut balances = Map::new(&env);
        balances.set(&admin, &initial_supply);
        
        Self {
            admin,
            total_supply: initial_supply,
            balances,
        }
    }
    
    /// Transfer function - Missing network validation
    pub fn transfer(env: Env, from: Address, to: Address, amount: u64) {
        // ❌ No network validation before sensitive operation
        // This transfer could have different behavior across networks
        
        // Perform transfer logic...
    }
    
    /// Mint function - Missing network validation
    pub fn mint(env: Env, to: Address, amount: u64) {
        // ❌ No network validation
        // Minting on wrong network could be catastrophic
        
        // Mint logic...
    }
    
    /// Generate address - Missing network validation
    pub fn create_sub_account(env: Env) -> Address {
        // ❌ Creating addresses without network validation
        Address::generate(&env)
    }
}
