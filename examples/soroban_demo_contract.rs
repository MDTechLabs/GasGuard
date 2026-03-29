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
    pub last_health_check: u64,      // Timestamp of last health check
    pub total_operations: u32,       // Total operations performed
    // Circuit breaker state
    pub paused: bool,                // Global pause state
    pub paused_modules: Map<Symbol, bool>, // Module-specific pause states
    pub emergency_pauser: Address,   // Address authorized for emergency pause
    pub last_pause_timestamp: u64,   // Last pause operation timestamp
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
    pub fn new(owner: Address, initial_balance: u64, emergency_pauser: Address) -> Result<Self, DemoError> {
        if initial_balance == 0 {
            return Err(DemoError::InvalidAmount);
        }
        
        Ok(Self {
            owner,
            balance: initial_balance,
            transaction_count: 0,
            version: 1, // Initialize version
            last_health_check: 0,
            total_operations: 0,
            paused: false,
            paused_modules: Map::new(),
            emergency_pauser,
            last_pause_timestamp: 0,
        })
    }
    
    
    /// Properly implemented transfer with error handling
    pub fn transfer(&mut self, env: Env, to: Address, amount: u64, nonce: u64, deadline: u64) -> Result<(), DemoError> {
        // Check if transfers are paused
        if self.is_paused(Some(Symbol::new(&env, "transfer"))) {
            return Err(DemoError::Unauthorized); // Reuse error for pause state
        }

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
        self.total_operations += 1;
        
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
        self.version
    }

    /// Comprehensive health check for monitoring and diagnostics
    pub fn perform_health_check(&mut self, env: Env) -> Result<HealthStatus, DemoError> {
        let current_timestamp = env.ledger().timestamp();
        self.last_health_check = current_timestamp;

        // Perform various health checks
        let balance_positive = self.balance > 0;
        let operations_consistent = self.total_operations >= self.transaction_count as u32;
        let version_valid = self.version > 0;

        // Check for any anomalies
        let has_anomalies = !balance_positive || !operations_consistent || !version_valid;

        Ok(HealthStatus {
            contract_balance: self.balance,
            transaction_count: self.transaction_count,
            total_operations: self.total_operations,
            contract_version: self.version,
            last_check_timestamp: current_timestamp,
            balance_positive,
            operations_consistent,
            version_valid,
            has_anomalies,
            ledger_sequence: env.ledger().sequence(),
        })
    }

    /// View-only health check (no state changes)
    pub fn get_health_status(&self, env: Env) -> HealthStatus {
        let balance_positive = self.balance > 0;
        let operations_consistent = self.total_operations >= self.transaction_count as u32;
        let version_valid = self.version > 0;
        let has_anomalies = !balance_positive || !operations_consistent || !version_valid;

        HealthStatus {
            contract_balance: self.balance,
            transaction_count: self.transaction_count,
            total_operations: self.total_operations,
            contract_version: self.version,
            last_check_timestamp: self.last_health_check,
            balance_positive,
            operations_consistent,
            version_valid,
            has_anomalies,
            ledger_sequence: env.ledger().sequence(),
        }
    }

    /// Quick health check for monitoring tools
    pub fn quick_health_check(&self) -> (bool, u64, u32) {
        let is_healthy = self.balance > 0 && self.version > 0;
        (is_healthy, self.balance, self.version)
    }

    /// Check critical invariants
    pub fn check_invariants(&self) -> bool {
        // Critical invariants that must always hold
        let balance_non_negative = self.balance >= 0;
        let operations_non_decreasing = self.total_operations >= self.transaction_count as u32;
        let version_set = self.version > 0;

        balance_non_negative && operations_non_decreasing && version_set
    }

    /// Emergency pause - can be called by emergency pauser or owner
    pub fn emergency_pause(&mut self, env: Env, caller: Address) -> Result<(), DemoError> {
        // Only emergency pauser or owner can pause
        if caller != self.emergency_pauser && caller != self.owner {
            return Err(DemoError::Unauthorized);
        }

        self.paused = true;
        self.last_pause_timestamp = env.ledger().timestamp();

        Ok(())
    }

    /// Pause specific module
    pub fn pause_module(&mut self, env: Env, caller: Address, module: Symbol) -> Result<(), DemoError> {
        if caller != self.emergency_pauser && caller != self.owner {
            return Err(DemoError::Unauthorized);
        }

        self.paused_modules.set(module, true);
        self.last_pause_timestamp = env.ledger().timestamp();

        Ok(())
    }

    /// Unpause (only owner, with timelock consideration)
    pub fn unpause(&mut self, env: Env, caller: Address) -> Result<(), DemoError> {
        if caller != self.owner {
            return Err(DemoError::Unauthorized);
        }

        // Simple timelock: require some time has passed since last pause
        let time_since_pause = env.ledger().timestamp() - self.last_pause_timestamp;
        if time_since_pause < 3600 { // 1 hour minimum
            return Err(DemoError::TransactionExpired); // Reuse error for timelock
        }

        self.paused = false;
        Ok(())
    }

    /// Unpause specific module
    pub fn unpause_module(&mut self, env: Env, caller: Address, module: Symbol) -> Result<(), DemoError> {
        if caller != self.owner {
            return Err(DemoError::Unauthorized);
        }

        self.paused_modules.set(module, false);
        Ok(())
    }

    /// Check if contract is paused (globally or for specific module)
    pub fn is_paused(&self, module: Option<Symbol>) -> bool {
        if self.paused {
            return true;
        }

        if let Some(module_key) = module {
            return self.paused_modules.get(module_key).unwrap_or(false);
        }

        false
    }

    /// Get pause status for multiple modules
    pub fn get_pause_status(&self, modules: Vec<Symbol>) -> Vec<bool> {
        modules.iter().map(|module| self.is_paused(Some(*module))).collect()
    }

    /// Emergency action that works even when paused
    pub fn emergency_action(&mut self, env: Env, caller: Address, action_type: Symbol) -> Result<(), DemoError> {
        if caller != self.emergency_pauser && caller != self.owner {
            return Err(DemoError::Unauthorized);
        }

        // Emergency actions can be performed even when paused
        // Implementation depends on specific emergency logic needed

        match action_type {
            _ => {
                // Placeholder for emergency actions
                // Could include fund recovery, state reset, etc.
            }
        }

        Ok(())
    }

    /// Update emergency pauser (only owner)
    pub fn update_emergency_pauser(&mut self, caller: Address, new_pauser: Address) -> Result<(), DemoError> {
        if caller != self.owner {
            return Err(DemoError::Unauthorized);
        }

        self.emergency_pauser = new_pauser;
        Ok(())
    }
}
}
}

/// Health status structure for comprehensive monitoring
#[contracttype]
pub struct HealthStatus {
    pub contract_balance: u64,
    pub transaction_count: u32,
    pub total_operations: u32,
    pub contract_version: u32,
    pub last_check_timestamp: u64,
    pub balance_positive: bool,
    pub operations_consistent: bool,
    pub version_valid: bool,
    pub has_anomalies: bool,
    pub ledger_sequence: u32,
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