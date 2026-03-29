//! Example Soroban contract demonstrating various analysis scenarios
//!
//! This contract showcases different patterns that GasGuard's Soroban analyzer
//! can detect, including both good and problematic practices.

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol, Map};

/// A token contract with various issues for demonstration purposes
#[contracttype]
pub struct DemoTokenContract {
    pub admin: Address,
    pub total_supply: u64,
    pub balances: Map<Address, u64>,
    pub unused_counter: u128,        // Issue: unused state variable
    pub inefficient_field: String,   // Issue: String instead of Symbol
}

/// Another contract showing good practices
#[contracttype]
pub struct OptimizedContract {
    pub owner: Address,
    pub balance: u64,
    pub transaction_count: u32,
    pub version: u32,                // ✅ Version tracking (#123)
}

#[contractimpl]
impl DemoTokenContract {
    /// Constructor with some issues
    pub fn new(admin: Address, initial_supply: u64) -> Self {
        let mut balances = Map::new();
        balances.set(admin, initial_supply);
        
        Self {
            admin,
            total_supply: initial_supply,
            balances,
            unused_counter: 0,  // Never used
            inefficient_field: "demo".to_string(),  // Expensive String operation
        }
    }
    
    /// Transfer function with multiple issues
    pub fn transfer(&mut self, from: Address, to: Address, amount: u64) {
        // Issue: Multiple storage reads without caching
        let from_balance = self.balances.get(from).unwrap_or(0);
        let to_balance = self.balances.get(to).unwrap_or(0);
        
        // Issue: No error handling (should return Result)
        self.balances.set(from, from_balance - amount);
        self.balances.set(to, to_balance + amount);
    }
    
    /// Function with unbounded loop
    pub fn process_all_accounts(&self, accounts: Vec<Address>) {
        // Issue: Potentially unbounded loop
        for account in accounts {
            let balance = self.balances.get(account).unwrap_or(0);
            // Process balance...
        }
    }
    
    /// Function with expensive operations
    pub fn generate_report(&self) -> String {
        // Issue: Multiple expensive string operations
        let report = "Report: ".to_string();
        let total = self.total_supply.to_string();
        let admin_str = format!("Admin: {:?}", self.admin);
        
        format!("{}{}{}", report, total, admin_str)
    }

    /// Claim airdrop - Issue #117: Missing expiration logic
    pub fn claim_airdrop(&mut self, env: Env, user: Address) {
        // ❌ No expiration check
        let balance = self.balances.get(user.clone()).unwrap_or(0);
        self.balances.set(user, balance + 100);
    }
    
    /// Swap tokens - Issue #118: Vulnerable to front-running
    pub fn swap_tokens(&mut self, env: Env, from: Address, to: Address, amount: u64) {
        // ❌ No nonce, deadline, or min_amount check
        let from_balance = self.balances.get(from.clone()).unwrap_or(0);
        self.balances.set(from, from_balance - amount);
        let to_balance = self.balances.get(to.clone()).unwrap_or(0);
        self.balances.set(to, to_balance + (amount * 2)); // Mock swap
    }
    
    /// Generate random ID - Issue #119: Insecure randomness
    pub fn generate_random_id(&self, env: Env) -> u64 {
        // ❌ Predictable randomness source
        let timestamp = env.ledger().timestamp();
        timestamp % 1000000
    }
}

#[contractimpl]
impl OptimizedContract {
    /// Well-structured constructor
    pub fn new(owner: Address, initial_balance: u64) -> Result<Self, DemoError> {
        if initial_balance == 0 {
            return Err(DemoError::InvalidAmount);
        }
        
        Ok(Self {
            owner,
            balance: initial_balance,
            transaction_count: 0,
            version: 1, // Initialize version
        })
    }
    
    
    /// Properly implemented transfer with error handling
    pub fn transfer(&mut self, env: Env, to: Address, amount: u64, nonce: u64, deadline: u64) -> Result<(), DemoError> {
        // ✅ Anti-Front-Running: Nonce and Deadline check (#118)
        if env.ledger().timestamp() > deadline {
            return Err(DemoError::TransactionExpired);
        }
        
        // Nonce validation logic would go here...

        if amount == 0 {
            return Err(DemoError::InvalidAmount);
        }
        
        if self.balance < amount {
            return Err(DemoError::InsufficientBalance);
        }
        
        // Cache storage value for efficiency
        let current_balance = self.balance;
        self.balance = current_balance - amount;
        self.transaction_count += 1;
        
        Ok(())
    }

    /// Secure claim with expiry - Issue #117
    pub fn secure_claim(&mut self, env: Env, user: Address, deadline: u64) -> Result<(), DemoError> {
        // ✅ Expiry enforced
        if env.ledger().timestamp() > deadline {
            return Err(DemoError::TransactionExpired);
        }
        
        user.require_auth();
        self.balance += 50;
        
        Ok(())
    }

    /// Secure randomness - Issue #119
    pub fn get_secure_random(&self, env: Env) -> u64 {
        // ✅ Using pseudo_random
        env.pseudo_random().u64_in_range(0..100)
    }

    /// Version tracking - Issue #123
    pub fn version(&self) -> u32 {
        1 // v1
    }
}

/// Error type for the contract
#[contracttype]
#[derive(Debug, Clone)]
pub enum DemoError {
    InvalidAmount,
    InsufficientBalance,
    Unauthorized,
    TransactionExpired,
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{vec, Env};
    
    #[test]
    fn test_demo_contract_analysis() {
        let env = Env::default();
        let admin = Address::generate(&env);
        
        let mut contract = DemoTokenContract::new(admin, 1000);
        
        // This contract should trigger multiple GasGuard warnings:
        // 1. Unused state variable (unused_counter)
        // 2. Inefficient field type (String instead of Symbol)
        // 3. Multiple storage accesses without caching
        // 4. Missing error handling in transfer
        // 5. Potentially unbounded loop
        // 6. Expensive string operations
        
        let recipient = Address::generate(&env);
        contract.transfer(admin, recipient, 100);
        
        assert_eq!(contract.balances.get(admin).unwrap_or(0), 900);
        assert_eq!(contract.balances.get(recipient).unwrap_or(0), 100);
    }
    
    #[test]
    fn test_optimized_contract() {
        let env = Env::default();
        let owner = Address::generate(&env);
        
        let mut contract = OptimizedContract::new(owner, 1000).unwrap();
        
        // This contract should have minimal GasGuard warnings
        // as it follows best practices
        
        let recipient = Address::generate(&env);
        contract.transfer(recipient, 100).unwrap();
        
        assert_eq!(contract.get_balance(), 900);
        assert_eq!(contract.transaction_count, 1);
    }
}