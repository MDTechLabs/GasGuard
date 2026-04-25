use cw_storage_plus::{Item, Map};
use cosmwasm_std::Uint128;
use crate::msg::PropertyMetadata;

// Property metadata storage
pub const METADATA: Map<&str, PropertyMetadata> = Map::new("metadata");

// Current nonce for each user (next expected nonce)
pub const NEXT_NONCE: Map<&str, u64> = Map::new("next_nonce");

// #137 — Replay attack protection: track processed transaction IDs
// Key: tx_id (string), Value: true if already processed
pub const PROCESSED_TX_IDS: Map<&str, bool> = Map::new("processed_tx_ids");

// Protocol fee balances per address (or per token)
pub const FEE_BALANCES: Map<&str, Uint128> = Map::new("fee_balances");

// Treasury balance
pub const TREASURY_BALANCE: Item<Uint128> = Item::new("treasury_balance");

// Authorized roles (admin, treasury, etc)
pub const ADMIN: Item<String> = Item::new("admin");
pub const AUTHORIZED_ROLES: Map<&str, bool> = Map::new("authorized_roles");

// #135 — Config migration: version tracking
pub const CONFIG_VERSION: Item<u32> = Item::new("config_version");

/// Current schema version — bump this whenever a breaking config change is made.
pub const CURRENT_CONFIG_VERSION: u32 = 1;
