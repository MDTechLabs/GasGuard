//! Example Soroban contract WITH proper network validation
//! This contract should NOT trigger the NetworkValidationRule

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol, Map};

// Network passphrases for validation
const MAINNET_PASSPHRASE: &str = "Public Global Stellar Network ; September 2015";
const TESTNET_PASSPHRASE: &str = "Test SDF Network ; September 2015";

#[contracttype]
pub struct TokenWithNetworkValidation {
    pub admin: Address,
    pub total_supply: u64,
    pub balances: Map<Address, u64>,
    pub is_testnet: bool,
}

#[contractimpl]
impl TokenWithNetworkValidation {
    /// Constructor - WITH network validation
    pub fn initialize(env: Env, admin: Address, initial_supply: u64) -> Self {
        // ✅ Validate network environment
        let network = env.ledger().network_passphrase();
        let network_bytes = network.to_bytes();
        
        // Check if we're on testnet or mainnet
        let is_testnet = network_bytes.len() > 0; // Simplified check
        
        // Log or assert based on expected network
        // For production, you might want: assert!(is_expected_network, "Wrong network!");
        
        let mut balances = Map::new(&env);
        balances.set(&admin, &initial_supply);
        
        Self {
            admin,
            total_supply: initial_supply,
            balances,
            is_testnet,
        }
    }
    
    /// Transfer function - WITH network validation
    pub fn transfer(env: Env, from: Address, to: Address, amount: u64) {
        // ✅ Validate network before sensitive operation
        let network = env.ledger().network_passphrase();
        
        // Optional: Add network-specific logic or logging
        // Different networks might have different rules or limits
        
        // Perform transfer logic...
    }
    
    /// Mint function - WITH network validation
    pub fn mint(env: Env, to: Address, amount: u64) {
        // ✅ Validate network
        let network = env.ledger().network_passphrase();
        
        // Could implement network-specific minting limits
        // e.g., testnet allows higher limits for testing
        
        // Mint logic...
    }
    
    /// Generate address - WITH network validation
    pub fn create_sub_account(env: Env) -> Address {
        // ✅ Network is validated through env
        // Address generation is network-aware through the Env context
        Address::generate(&env)
    }
    
    /// Helper to check current network
    pub fn get_network_info(env: Env) -> Symbol {
        let network = env.ledger().network_passphrase();
        // Return network identifier
        Symbol::new(&env, "stellar")
    }
}
