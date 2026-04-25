//! Tests for On-Chain Configuration Registry

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    vec, Address, Env, Symbol, String as SorobanString,
};

use crate::contract::{OnChainConfigRegistry, OnChainConfigRegistryClient};

#[test]
fn test_initialization() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let config_updater = Address::generate(&env);
    let emergency_admin = Address::generate(&env);

    let contract_id = env.register_contract(None, OnChainConfigRegistry);
    let client = OnChainConfigRegistryClient::new(&env, &contract_id);

    client.initialize(&admin, &config_updater, &emergency_admin);

    // Test that initialization worked
    assert_eq!(client.get_current_version(), 1);
    assert_eq!(client.get_config_count(), 0);
}

#[test]
fn test_set_and_get_uint256() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let config_updater = Address::generate(&env);
    let emergency_admin = Address::generate(&env);

    let contract_id = env.register_contract(None, OnChainConfigRegistry);
    let client = OnChainConfigRegistryClient::new(&env, &contract_id);

    client.initialize(&admin, &config_updater, &emergency_admin);

    let key = Symbol::new(&env, "test_key");
    let value: u64 = 12345;

    client.set_uint256(&key, &value);

    assert_eq!(client.get_uint256(&key), value);
    assert!(client.config_exists(&key));
}

#[test]
fn test_set_and_get_address() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let config_updater = Address::generate(&env);
    let emergency_admin = Address::generate(&env);
    let test_address = Address::generate(&env);

    let contract_id = env.register_contract(None, OnChainConfigRegistry);
    let client = OnChainConfigRegistryClient::new(&env, &contract_id);

    client.initialize(&admin, &config_updater, &emergency_admin);

    let key = Symbol::new(&env, "test_addr");

    client.set_address(&key, &test_address);

    assert_eq!(client.get_address(&key), test_address);
}

#[test]
fn test_set_and_get_bool() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let config_updater = Address::generate(&env);
    let emergency_admin = Address::generate(&env);

    let contract_id = env.register_contract(None, OnChainConfigRegistry);
    let client = OnChainConfigRegistryClient::new(&env, &contract_id);

    client.initialize(&admin, &config_updater, &emergency_admin);

    let key = Symbol::new(&env, "test_bool");

    client.set_bool(&key, &true);
    assert_eq!(client.get_bool(&key), true);

    client.set_bool(&key, &false);
    assert_eq!(client.get_bool(&key), false);
}

#[test]
fn test_set_and_get_string() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let config_updater = Address::generate(&env);
    let emergency_admin = Address::generate(&env);

    let contract_id = env.register_contract(None, OnChainConfigRegistry);
    let client = OnChainConfigRegistryClient::new(&env, &contract_id);

    client.initialize(&admin, &config_updater, &emergency_admin);

    let key = Symbol::new(&env, "test_str");
    let value = SorobanString::from_str(&env, "Hello, Soroban!");

    client.set_string(&key, &value);

    assert_eq!(client.get_string(&key), value);
}

#[test]
fn test_batch_update() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let config_updater = Address::generate(&env);
    let emergency_admin = Address::generate(&env);

    let contract_id = env.register_contract(None, OnChainConfigRegistry);
    let client = OnChainConfigRegistryClient::new(&env, &contract_id);

    client.initialize(&admin, &config_updater, &emergency_admin);

    let key1 = Symbol::new(&env, "batch1");
    let key2 = Symbol::new(&env, "batch2");

    let updates = vec![
        &env,
        ConfigUpdate {
            key: key1.clone(),
            config_type: ConfigType::Uint256,
            uint_value: 100,
            address_value: Address::from_contract_id(&[0; 32]),
            bool_value: false,
            bytes32_value: [0; 32],
            string_value: SorobanString::from_str(&env, ""),
        },
        ConfigUpdate {
            key: key2.clone(),
            config_type: ConfigType::Bool,
            uint_value: 0,
            address_value: Address::from_contract_id(&[0; 32]),
            bool_value: true,
            bytes32_value: [0; 32],
            string_value: SorobanString::from_str(&env, ""),
        },
    ];

    let initial_version = client.get_current_version();
    client.batch_update(&updates);

    assert_eq!(client.get_current_version(), initial_version + 1);
    assert_eq!(client.get_uint256(&key1), 100);
    assert_eq!(client.get_bool(&key2), true);
}

#[test]
fn test_access_control() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let config_updater = Address::generate(&env);
    let emergency_admin = Address::generate(&env);
    let unauthorized_user = Address::generate(&env);

    let contract_id = env.register_contract(None, OnChainConfigRegistry);
    let client = OnChainConfigRegistryClient::new(&env, &contract_id);

    client.initialize(&admin, &config_updater, &emergency_admin);

    let key = Symbol::new(&env, "access_test");

    // Test that unauthorized user cannot set config
    env.set_auths(&[]);
    let result = client.try_set_uint256(&key, &123);
    assert!(result.is_err());

    // Test that config updater can set config
    env.set_auths(&[config_updater.clone()]);
    client.set_uint256(&key, &123);
    assert_eq!(client.get_uint256(&key), 123);
}

#[test]
fn test_delete_config() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let config_updater = Address::generate(&env);
    let emergency_admin = Address::generate(&env);

    let contract_id = env.register_contract(None, OnChainConfigRegistry);
    let client = OnChainConfigRegistryClient::new(&env, &contract_id);

    client.initialize(&admin, &config_updater, &emergency_admin);

    let key = Symbol::new(&env, "to_delete");
    client.set_uint256(&key, &999);

    assert!(client.config_exists(&key));

    client.delete_config(&key);

    assert!(!client.config_exists(&key));
}

#[test]
fn test_config_entry_details() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let config_updater = Address::generate(&env);
    let emergency_admin = Address::generate(&env);

    let contract_id = env.register_contract(None, OnChainConfigRegistry);
    let client = OnChainConfigRegistryClient::new(&env, &contract_id);

    client.initialize(&admin, &config_updater, &emergency_admin);

    let key = Symbol::new(&env, "entry_test");
    let value: u64 = 777;

    client.set_uint256(&key, &value);

    let entry = client.get_config_entry(&key);

    assert_eq!(entry.uint_value, value);
    assert_eq!(entry.updated_by, config_updater);
    assert!(entry.exists);
    assert_eq!(entry.version, 1);
}

#[test]
fn test_invalid_address_rejection() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let config_updater = Address::generate(&env);
    let emergency_admin = Address::generate(&env);

    let contract_id = env.register_contract(None, OnChainConfigRegistry);
    let client = OnChainConfigRegistryClient::new(&env, &contract_id);

    client.initialize(&admin, &config_updater, &emergency_admin);

    let key = Symbol::new(&env, "invalid_addr");
    let zero_address = Address::from_contract_id(&[0; 32]);

    let result = client.try_set_address(&key, &zero_address);
    assert!(result.is_err());
}

#[test]
fn test_non_existent_config_access() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let config_updater = Address::generate(&env);
    let emergency_admin = Address::generate(&env);

    let contract_id = env.register_contract(None, OnChainConfigRegistry);
    let client = OnChainConfigRegistryClient::new(&env, &contract_id);

    client.initialize(&admin, &config_updater, &emergency_admin);

    let non_existent_key = Symbol::new(&env, "non_existent");

    let result = client.try_get_uint256(&non_existent_key);
    assert!(result.is_err());
}

#[test]
fn test_wrong_type_access() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let config_updater = Address::generate(&env);
    let emergency_admin = Address::generate(&env);

    let contract_id = env.register_contract(None, OnChainConfigRegistry);
    let client = OnChainConfigRegistryClient::new(&env, &contract_id);

    client.initialize(&admin, &config_updater, &emergency_admin);

    let key = Symbol::new(&env, "type_test");
    client.set_uint256(&key, &42);

    // Try to get as bool - should fail
    let result = client.try_get_bool(&key);
    assert!(result.is_err());
}

#[test]
fn test_admin_functions() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let config_updater = Address::generate(&env);
    let emergency_admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let new_updater = Address::generate(&env);

    let contract_id = env.register_contract(None, OnChainConfigRegistry);
    let client = OnChainConfigRegistryClient::new(&env, &contract_id);

    client.initialize(&admin, &config_updater, &emergency_admin);

    // Update admin
    client.update_admin(&new_admin);
    // Note: In a real scenario, you'd need to check the new admin was set

    // Update config updater
    client.update_config_updater(&new_updater);
    // Note: In a real scenario, you'd need to check the new updater was set
}

#[test]
fn test_batch_update_limits() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let config_updater = Address::generate(&env);
    let emergency_admin = Address::generate(&env);

    let contract_id = env.register_contract(None, OnChainConfigRegistry);
    let client = OnChainConfigRegistryClient::new(&env, &contract_id);

    client.initialize(&admin, &config_updater, &emergency_admin);

    // Test empty batch
    let empty_updates = vec![&env];
    let result = client.try_batch_update(&empty_updates);
    assert!(result.is_err());

    // Test oversized batch (51 updates)
    let mut oversized_updates = vec![&env];
    for i in 0..51 {
        let key = Symbol::new(&env, &format!("key{}", i));
        oversized_updates.push_back(ConfigUpdate {
            key,
            config_type: ConfigType::Uint256,
            uint_value: i as u64,
            address_value: Address::from_contract_id(&[0; 32]),
            bool_value: false,
            bytes32_value: [0; 32],
            string_value: SorobanString::from_str(&env, ""),
        });
    }

    let result = client.try_batch_update(&oversized_updates);
    assert!(result.is_err());
}