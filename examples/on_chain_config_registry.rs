//! On-Chain Configuration Registry for Soroban
//!
//! This contract provides a decentralized configuration registry for storing and managing
//! protocol parameters with type safety, access control, and versioning support.

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, symbol_short, vec, Env, Symbol, Vec, Map, Address, String as SorobanString
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ConfigType {
    Uint256 = 0,
    Address = 1,
    Bool = 2,
    Bytes32 = 3,
    String = 4,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConfigEntry {
    pub config_type: ConfigType,
    pub uint_value: u64, // Soroban uses u64 for large numbers
    pub address_value: Address,
    pub bool_value: bool,
    pub bytes32_value: [u8; 32],
    pub string_value: SorobanString,
    pub version: u32,
    pub last_updated: u64,
    pub updated_by: Address,
    pub exists: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConfigUpdate {
    pub key: Symbol,
    pub config_type: ConfigType,
    pub uint_value: u64,
    pub address_value: Address,
    pub bool_value: bool,
    pub bytes32_value: [u8; 32],
    pub string_value: SorobanString,
}

#[contracterror]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ConfigError {
    NotAuthorized = 1,
    ConfigNotFound = 2,
    InvalidConfigType = 3,
    InvalidAddress = 4,
    BatchTooLarge = 5,
    InvalidVersion = 6,
}

#[contract]
pub struct OnChainConfigRegistry;

#[contractimpl]
impl OnChainConfigRegistry {
    // Constants for common config keys
    pub const FEE_NUMERATOR: Symbol = symbol_short!("FEE_NUM");
    pub const FEE_DENOMINATOR: Symbol = symbol_short!("FEE_DEN");
    pub const MAX_TX_LIMIT: Symbol = symbol_short!("MAX_TX_LIM");
    pub const MIN_TX_LIMIT: Symbol = symbol_short!("MIN_TX_LIM");
    pub const TREASURY_ADDR: Symbol = symbol_short!("TREASURY");
    pub const EMERGENCY_PAUSE: Symbol = symbol_short!("EMERG_PAUSE");
    pub const MAINTENANCE_MODE: Symbol = symbol_short!("MAINT_MODE");

    /// Initialize the configuration registry
    pub fn initialize(env: Env, admin: Address, config_updater: Address, emergency_admin: Address) {
        // Check that the contract hasn't been initialized yet
        if env.storage().instance().has(&symbol_short!("admin")) {
            panic!("Contract already initialized");
        }

        admin.require_auth();
        config_updater.require_auth();

        env.storage().instance().set(&symbol_short!("admin"), &admin);
        env.storage().instance().set(&symbol_short!("config_updater"), &config_updater);
        env.storage().instance().set(&symbol_short!("emergency_admin"), &emergency_admin);
        env.storage().instance().set(&symbol_short!("current_version"), &1u32);
        env.storage().instance().set(&symbol_short!("config_keys"), &vec![&env]);
    }

    /// Set a uint256 configuration value
    pub fn set_uint256(env: Env, key: Symbol, value: u64) -> Result<(), ConfigError> {
        Self::check_config_updater_auth(&env)?;
        Self::set_config(&env, key, ConfigType::Uint256, value, Address::from_contract_id(&[0; 32]), false, [0; 32], SorobanString::from_str(&env, ""))
    }

    /// Set an address configuration value
    pub fn set_address(env: Env, key: Symbol, value: Address) -> Result<(), ConfigError> {
        Self::check_config_updater_auth(&env)?;
        if value == Address::from_contract_id(&[0; 32]) {
            return Err(ConfigError::InvalidAddress);
        }
        Self::set_config(&env, key, ConfigType::Address, 0, value, false, [0; 32], SorobanString::from_str(&env, ""))
    }

    /// Set a boolean configuration value
    pub fn set_bool(env: Env, key: Symbol, value: bool) -> Result<(), ConfigError> {
        Self::check_config_updater_auth(&env)?;
        Self::set_config(&env, key, ConfigType::Bool, 0, Address::from_contract_id(&[0; 32]), value, [0; 32], SorobanString::from_str(&env, ""))
    }

    /// Set a bytes32 configuration value
    pub fn set_bytes32(env: Env, key: Symbol, value: [u8; 32]) -> Result<(), ConfigError> {
        Self::check_config_updater_auth(&env)?;
        Self::set_config(&env, key, ConfigType::Bytes32, 0, Address::from_contract_id(&[0; 32]), false, value, SorobanString::from_str(&env, ""))
    }

    /// Set a string configuration value
    pub fn set_string(env: Env, key: Symbol, value: SorobanString) -> Result<(), ConfigError> {
        Self::check_config_updater_auth(&env)?;
        Self::set_config(&env, key, ConfigType::String, 0, Address::from_contract_id(&[0; 32]), false, [0; 32], value)
    }

    /// Batch update multiple configurations
    pub fn batch_update(env: Env, updates: Vec<ConfigUpdate>) -> Result<(), ConfigError> {
        Self::check_config_updater_auth(&env)?;

        let updates_len = updates.len();
        if updates_len == 0 {
            return Err(ConfigError::BatchTooLarge); // Using this for empty batch
        }
        if updates_len > 50 {
            return Err(ConfigError::BatchTooLarge);
        }

        let mut current_version: u32 = env.storage().instance().get(&symbol_short!("current_version")).unwrap_or(1);
        current_version += 1;
        env.storage().instance().set(&symbol_short!("current_version"), &current_version);

        let mut updated_keys: Vec<Symbol> = vec![&env];

        for update in updates.iter() {
            updated_keys.push_back(update.key.clone());

            Self::set_config(
                &env,
                update.key.clone(),
                update.config_type.clone(),
                update.uint_value,
                update.address_value.clone(),
                update.bool_value,
                update.bytes32_value,
                update.string_value.clone(),
            )?;

            // Update version for this entry
            let mut entry = Self::get_config_entry_internal(&env, &update.key)?;
            entry.version = current_version;
            env.storage().persistent().set(&update.key, &entry);
        }

        // Store version snapshot
        env.storage().persistent().set(&symbol_short!("version_snapshot"), &updated_keys);

        // Emit batch update event
        env.events().publish(
            (symbol_short!("config_batch"), current_version),
            (updated_keys, env.invoker(), env.ledger().timestamp())
        );

        Ok(())
    }

    /// Delete a configuration entry
    pub fn delete_config(env: Env, key: Symbol) -> Result<(), ConfigError> {
        Self::check_admin_auth(&env)?;

        if !env.storage().persistent().has(&key) {
            return Err(ConfigError::ConfigNotFound);
        }

        env.storage().persistent().remove(&key);

        // Remove from keys array (simplified)
        let mut keys: Vec<Symbol> = env.storage().instance().get(&symbol_short!("config_keys")).unwrap_or(vec![&env]);
        let mut new_keys: Vec<Symbol> = vec![&env];

        for k in keys.iter() {
            if k != key {
                new_keys.push_back(k);
            }
        }

        env.storage().instance().set(&symbol_short!("config_keys"), &new_keys);

        env.events().publish(
            (symbol_short!("config_deleted"), key),
            (env.invoker(), env.ledger().timestamp())
        );

        Ok(())
    }

    /// Get uint256 configuration value
    pub fn get_uint256(env: Env, key: Symbol) -> Result<u64, ConfigError> {
        let entry = Self::get_config_entry_internal(&env, &key)?;
        if entry.config_type != ConfigType::Uint256 {
            return Err(ConfigError::InvalidConfigType);
        }
        Ok(entry.uint_value)
    }

    /// Get address configuration value
    pub fn get_address(env: Env, key: Symbol) -> Result<Address, ConfigError> {
        let entry = Self::get_config_entry_internal(&env, &key)?;
        if entry.config_type != ConfigType::Address {
            return Err(ConfigError::InvalidConfigType);
        }
        Ok(entry.address_value)
    }

    /// Get boolean configuration value
    pub fn get_bool(env: Env, key: Symbol) -> Result<bool, ConfigError> {
        let entry = Self::get_config_entry_internal(&env, &key)?;
        if entry.config_type != ConfigType::Bool {
            return Err(ConfigError::InvalidConfigType);
        }
        Ok(entry.bool_value)
    }

    /// Get bytes32 configuration value
    pub fn get_bytes32(env: Env, key: Symbol) -> Result<[u8; 32], ConfigError> {
        let entry = Self::get_config_entry_internal(&env, &key)?;
        if entry.config_type != ConfigType::Bytes32 {
            return Err(ConfigError::InvalidConfigType);
        }
        Ok(entry.bytes32_value)
    }

    /// Get string configuration value
    pub fn get_string(env: Env, key: Symbol) -> Result<SorobanString, ConfigError> {
        let entry = Self::get_config_entry_internal(&env, &key)?;
        if entry.config_type != ConfigType::String {
            return Err(ConfigError::InvalidConfigType);
        }
        Ok(entry.string_value)
    }

    /// Get configuration entry details
    pub fn get_config_entry(env: Env, key: Symbol) -> Result<ConfigEntry, ConfigError> {
        Self::get_config_entry_internal(&env, &key)
    }

    /// Get all configuration keys
    pub fn get_all_keys(env: Env) -> Vec<Symbol> {
        env.storage().instance().get(&symbol_short!("config_keys")).unwrap_or(vec![&env])
    }

    /// Get configuration keys for a specific version
    pub fn get_version_keys(env: Env, version: u32) -> Result<Vec<Symbol>, ConfigError> {
        let current_version: u32 = env.storage().instance().get(&symbol_short!("current_version")).unwrap_or(1);
        if version == 0 || version > current_version {
            return Err(ConfigError::InvalidVersion);
        }

        // For simplicity, return current keys. In production, you'd store historical snapshots
        Ok(Self::get_all_keys(env))
    }

    /// Check if configuration key exists
    pub fn config_exists(env: Env, key: Symbol) -> bool {
        env.storage().persistent().has(&key)
    }

    /// Get configuration count
    pub fn get_config_count(env: Env) -> u32 {
        Self::get_all_keys(env).len()
    }

    /// Update admin address
    pub fn update_admin(env: Env, new_admin: Address) -> Result<(), ConfigError> {
        Self::check_admin_auth(&env)?;
        new_admin.require_auth();
        env.storage().instance().set(&symbol_short!("admin"), &new_admin);
        Ok(())
    }

    /// Update config updater address
    pub fn update_config_updater(env: Env, new_updater: Address) -> Result<(), ConfigError> {
        Self::check_admin_auth(&env)?;
        new_updater.require_auth();
        env.storage().instance().set(&symbol_short!("config_updater"), &new_updater);
        Ok(())
    }

    /// Update emergency admin address
    pub fn update_emergency_admin(env: Env, new_emergency_admin: Address) -> Result<(), ConfigError> {
        Self::check_admin_auth(&env)?;
        env.storage().instance().set(&symbol_short!("emergency_admin"), &new_emergency_admin);
        Ok(())
    }

    /// Get current version
    pub fn get_current_version(env: Env) -> u32 {
        env.storage().instance().get(&symbol_short!("current_version")).unwrap_or(1)
    }

    // Internal helper functions

    fn check_admin_auth(env: &Env) -> Result<(), ConfigError> {
        let admin: Address = env.storage().instance().get(&symbol_short!("admin"))
            .ok_or(ConfigError::NotAuthorized)?;
        admin.require_auth();
        Ok(())
    }

    fn check_config_updater_auth(env: &Env) -> Result<(), ConfigError> {
        let config_updater: Address = env.storage().instance().get(&symbol_short!("config_updater"))
            .ok_or(ConfigError::NotAuthorized)?;
        let admin: Address = env.storage().instance().get(&symbol_short!("admin"))
            .ok_or(ConfigError::NotAuthorized)?;
        let emergency_admin: Address = env.storage().instance().get(&symbol_short!("emergency_admin"))
            .unwrap_or(admin.clone());

        let invoker = env.invoker();
        if invoker != config_updater && invoker != admin && invoker != emergency_admin {
            return Err(ConfigError::NotAuthorized);
        }

        invoker.require_auth();
        Ok(())
    }

    fn set_config(
        env: &Env,
        key: Symbol,
        config_type: ConfigType,
        uint_value: u64,
        address_value: Address,
        bool_value: bool,
        bytes32_value: [u8; 32],
        string_value: SorobanString,
    ) -> Result<(), ConfigError> {
        let is_new = !env.storage().persistent().has(&key);
        let current_version: u32 = env.storage().instance().get(&symbol_short!("current_version")).unwrap_or(1);

        if is_new {
            let mut keys: Vec<Symbol> = env.storage().instance().get(&symbol_short!("config_keys")).unwrap_or(vec![env]);
            keys.push_back(key.clone());
            env.storage().instance().set(&symbol_short!("config_keys"), &keys);
        }

        let entry = ConfigEntry {
            config_type: config_type.clone(),
            uint_value,
            address_value,
            bool_value,
            bytes32_value,
            string_value,
            version: current_version,
            last_updated: env.ledger().timestamp(),
            updated_by: env.invoker(),
            exists: true,
        };

        env.storage().persistent().set(&key, &entry);

        env.events().publish(
            (symbol_short!("config_updated"), key, config_type),
            (current_version, env.invoker(), env.ledger().timestamp())
        );

        Ok(())
    }

    fn get_config_entry_internal(env: &Env, key: &Symbol) -> Result<ConfigEntry, ConfigError> {
        env.storage().persistent().get(key)
            .ok_or(ConfigError::ConfigNotFound)
    }
}