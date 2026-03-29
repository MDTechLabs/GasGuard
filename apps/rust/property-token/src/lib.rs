pub mod msg;
pub mod state;
pub mod security;

use cosmwasm_std::{
    entry_point, to_json_binary, Binary, Deps, DepsMut, Env, MessageInfo, Order,
    Response, StdError, StdResult, Uint128, BankMsg, Coin,
};
use crate::msg::{
    Auth, BatchMsg, ExecuteMsg, InstantiateMsg, MigrateMsg,
    PropertyMetadata, QueryMsg, SelfCheckResponse, TreasuryAction,
};
use crate::state::{
    ADMIN, AUTHORIZED_ROLES, CONFIG_VERSION, CURRENT_CONFIG_VERSION,
    FEE_BALANCES, METADATA, TREASURY_BALANCE,
};
use crate::security::{ensure_authorized, prevent_replay};

// ── Entry points ─────────────────────────────────────────────────────────────

#[entry_point]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    msg: InstantiateMsg,
) -> StdResult<Response> {
    let admin = msg.admin.unwrap_or_else(|| info.sender.to_string());
    ADMIN.save(deps.storage, &admin)?;
    TREASURY_BALANCE.save(deps.storage, &Uint128::zero())?;
    // #135 — Record initial config version
    CONFIG_VERSION.save(deps.storage, &CURRENT_CONFIG_VERSION)?;

    Ok(Response::new()
        .add_attribute("action", "instantiate")
        .add_attribute("admin", &admin)
        .add_attribute("config_version", CURRENT_CONFIG_VERSION.to_string()))
}

#[entry_point]
pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> StdResult<Response> {
    match msg {
        ExecuteMsg::SetMetadata { token_id, metadata, auth } => {
            execute_set_metadata(deps, env, info, token_id, metadata, auth)
        }
        ExecuteMsg::UpdateMetadata { token_id, metadata, auth } => {
            execute_update_metadata(deps, env, info, token_id, metadata, auth)
        }
        ExecuteMsg::Batch { msgs, auth } => execute_batch(deps, env, info, msgs, auth),
        ExecuteMsg::WithdrawFees { recipient, amount, token, auth } => {
            execute_withdraw_fees(deps, env, info, recipient, amount, token, auth)
        }
        ExecuteMsg::TreasuryAction { action, auth } => {
            execute_treasury_action(deps, env, info, action, auth)
        }
        ExecuteMsg::UpdateConfig { new_admin, authorized_roles } => {
            execute_update_config(deps, env, info, new_admin, authorized_roles)
        }
        ExecuteMsg::CleanupStorage {} => execute_cleanup_storage(deps, env, info),
    }
}

#[entry_point]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::SelfCheck {} => to_json_binary(&query_self_check(deps)?),
    }
}

/// #135 — Config Migration entry point.
///
/// Validates the stored version, applies any needed transformations, then
/// bumps the version counter. Access-controlled: only the admin may call
/// `migrate` (enforced by the chain when the contract code is upgraded).
#[entry_point]
pub fn migrate(deps: DepsMut, _env: Env, msg: MigrateMsg) -> StdResult<Response> {
    let stored_version = CONFIG_VERSION.may_load(deps.storage)?.unwrap_or(0);

    if msg.target_version != CURRENT_CONFIG_VERSION {
        return Err(StdError::generic_err(format!(
            "MigrationVersionMismatch: expected {}, got {}",
            CURRENT_CONFIG_VERSION, msg.target_version
        )));
    }

    if stored_version >= CURRENT_CONFIG_VERSION {
        return Err(StdError::generic_err(format!(
            "AlreadyMigrated: stored version {} is already >= target {}",
            stored_version, CURRENT_CONFIG_VERSION
        )));
    }

    // Apply per-version migrations
    if stored_version < 1 {
        // v0 → v1: ensure TREASURY_BALANCE exists (may be absent on very old deploys)
        if TREASURY_BALANCE.may_load(deps.storage)?.is_none() {
            TREASURY_BALANCE.save(deps.storage, &Uint128::zero())?;
        }
    }

    CONFIG_VERSION.save(deps.storage, &CURRENT_CONFIG_VERSION)?;

    Ok(Response::new()
        .add_attribute("action", "migrate")
        .add_attribute("from_version", stored_version.to_string())
        .add_attribute("to_version", CURRENT_CONFIG_VERSION.to_string()))
}

// ── Execute handlers ──────────────────────────────────────────────────────────

pub fn execute_set_metadata(
    mut deps: DepsMut,
    env: Env,
    info: MessageInfo,
    token_id: String,
    metadata: PropertyMetadata,
    auth: Auth,
) -> StdResult<Response> {
    prevent_replay(&mut deps, &env, &info, auth.nonce, auth.expires_at, auth.tx_id.as_deref())?;
    METADATA.save(deps.storage, &token_id, &metadata)?;
    Ok(Response::new()
        .add_attribute("action", "set_metadata")
        .add_attribute("token_id", &token_id)
        .add_attribute("caller", info.sender.as_str()))
}

pub fn execute_update_metadata(
    mut deps: DepsMut,
    env: Env,
    info: MessageInfo,
    token_id: String,
    metadata: PropertyMetadata,
    auth: Auth,
) -> StdResult<Response> {
    prevent_replay(&mut deps, &env, &info, auth.nonce, auth.expires_at, auth.tx_id.as_deref())?;
    if !METADATA.has(deps.storage, &token_id) {
        return Err(StdError::generic_err("Property metadata not found"));
    }
    METADATA.save(deps.storage, &token_id, &metadata)?;
    Ok(Response::new()
        .add_attribute("action", "update_metadata")
        .add_attribute("token_id", &token_id)
        .add_attribute("caller", info.sender.as_str()))
}

pub fn execute_batch(
    mut deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msgs: Vec<BatchMsg>,
    auth: Auth,
) -> StdResult<Response> {
    prevent_replay(&mut deps, &env, &info, auth.nonce, auth.expires_at, auth.tx_id.as_deref())?;
    let mut response = Response::new().add_attribute("action", "execute_batch");
    for (idx, msg) in msgs.into_iter().enumerate() {
        match msg {
            BatchMsg::SetMetadata { token_id, metadata } => {
                METADATA.save(deps.storage, &token_id, &metadata)?;
                response = response.add_attribute(
                    format!("batch_event_{}", idx),
                    format!("set_metadata_{}", token_id),
                );
            }
            BatchMsg::UpdateMetadata { token_id, metadata } => {
                if !METADATA.has(deps.storage, &token_id) {
                    return Err(StdError::generic_err(format!(
                        "Property {} not found in batch",
                        token_id
                    )));
                }
                METADATA.save(deps.storage, &token_id, &metadata)?;
                response = response.add_attribute(
                    format!("batch_event_{}", idx),
                    format!("update_metadata_{}", token_id),
                );
            }
        }
    }
    Ok(response)
}

/// #137 — WithdrawFees now requires auth for replay protection.
pub fn execute_withdraw_fees(
    mut deps: DepsMut,
    env: Env,
    info: MessageInfo,
    recipient: String,
    amount: Uint128,
    token: String,
    auth: Auth,
) -> StdResult<Response> {
    ensure_authorized(&deps.as_ref(), &info)?;
    // #137: replay protection on sensitive fund operations
    prevent_replay(&mut deps, &env, &info, auth.nonce, auth.expires_at, auth.tx_id.as_deref())?;

    let current_balance = FEE_BALANCES.may_load(deps.storage, &token)?.unwrap_or_default();
    if amount > current_balance {
        return Err(StdError::generic_err(format!(
            "InsufficientFeeBalance: Available: {}, Requested: {}",
            current_balance, amount
        )));
    }
    let new_balance = current_balance
        .checked_sub(amount)
        .map_err(|e| StdError::generic_err(e.to_string()))?;
    FEE_BALANCES.save(deps.storage, &token, &new_balance)?;

    let bank_msg = BankMsg::Send {
        to_address: recipient.clone(),
        amount: vec![Coin { denom: token.clone(), amount }],
    };
    Ok(Response::new()
        .add_message(bank_msg)
        .add_attribute("action", "withdraw_fees")
        .add_attribute("recipient", recipient)
        .add_attribute("amount", amount)
        .add_attribute("token", token))
}

/// #137 — TreasuryAction now requires auth for replay protection.
pub fn execute_treasury_action(
    mut deps: DepsMut,
    env: Env,
    info: MessageInfo,
    action: TreasuryAction,
    auth: Auth,
) -> StdResult<Response> {
    ensure_authorized(&deps.as_ref(), &info)?;
    // #137: replay protection on treasury operations
    prevent_replay(&mut deps, &env, &info, auth.nonce, auth.expires_at, auth.tx_id.as_deref())?;

    match action {
        TreasuryAction::Deposit { amount } => {
            let current = TREASURY_BALANCE.load(deps.storage).unwrap_or_default();
            TREASURY_BALANCE.save(deps.storage, &(current + amount))?;
            Ok(Response::new()
                .add_attribute("action", "treasury_deposit")
                .add_attribute("amount", amount))
        }
        TreasuryAction::Withdraw { amount, recipient }
        | TreasuryAction::Transfer { amount, recipient } => {
            let current = TREASURY_BALANCE.load(deps.storage).unwrap_or_default();
            if amount > current {
                return Err(StdError::generic_err(
                    "TreasuryOverdraw: Insufficient funds in treasury vault.",
                ));
            }
            TREASURY_BALANCE.save(deps.storage, &(current - amount))?;
            let msg = BankMsg::Send {
                to_address: recipient.clone(),
                amount: vec![Coin { denom: "stablecoin".to_string(), amount }],
            };
            Ok(Response::new()
                .add_message(msg)
                .add_attribute("action", "treasury_outflow")
                .add_attribute("recipient", recipient)
                .add_attribute("amount", amount))
        }
    }
}

pub fn execute_update_config(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    new_admin: Option<String>,
    authorized_roles: Option<Vec<(String, bool)>>,
) -> StdResult<Response> {
    let admin = ADMIN.load(deps.storage)?;
    if info.sender.as_str() != admin {
        return Err(StdError::generic_err("Only the current admin can update config"));
    }
    if let Some(addr) = new_admin {
        ADMIN.save(deps.storage, &addr)?;
    }
    if let Some(roles) = authorized_roles {
        for (addr, is_auth) in roles {
            AUTHORIZED_ROLES.save(deps.storage, &addr, &is_auth)?;
        }
    }
    Ok(Response::new().add_attribute("action", "update_config"))
}

/// #136 — Storage Cleanup Utility
///
/// Removes:
/// - Zero-balance entries from `FEE_BALANCES` (saves storage rent)
/// - Explicitly revoked role entries (value == false) from `AUTHORIZED_ROLES`
///
/// Admin-only. Does not affect treasury, metadata, or nonce state.
pub fn execute_cleanup_storage(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
) -> StdResult<Response> {
    let admin = ADMIN.load(deps.storage)?;
    if info.sender.as_str() != admin {
        return Err(StdError::generic_err("Only admin can run storage cleanup"));
    }

    // Collect zero-balance fee keys
    let zero_fee_keys: Vec<String> = FEE_BALANCES
        .range(deps.storage, None, None, Order::Ascending)
        .filter_map(|item| {
            item.ok().and_then(|(k, v)| if v.is_zero() { Some(k) } else { None })
        })
        .collect();

    let zero_fee_count = zero_fee_keys.len() as u64;
    for key in &zero_fee_keys {
        FEE_BALANCES.remove(deps.storage, key.as_str());
    }

    // Collect revoked role keys (explicitly set to false — dead entries)
    let revoked_role_keys: Vec<String> = AUTHORIZED_ROLES
        .range(deps.storage, None, None, Order::Ascending)
        .filter_map(|item| {
            item.ok().and_then(|(k, v)| if !v { Some(k) } else { None })
        })
        .collect();

    let revoked_role_count = revoked_role_keys.len() as u64;
    for key in &revoked_role_keys {
        AUTHORIZED_ROLES.remove(deps.storage, key.as_str());
    }

    Ok(Response::new()
        .add_attribute("action", "cleanup_storage")
        .add_attribute("zero_fee_records_removed", zero_fee_count.to_string())
        .add_attribute("revoked_roles_removed", revoked_role_count.to_string()))
}

// ── Query handlers ─────────────────────────────────────────────────────────────

/// #132 — Contract Self-Check Routine
///
/// Validates critical state invariants without modifying any storage.
/// Returns a report listing all passed and failed checks.
pub fn query_self_check(deps: Deps) -> StdResult<SelfCheckResponse> {
    let mut failures: Vec<String> = Vec::new();
    let mut passed: Vec<String> = Vec::new();

    // 1. Admin must be set
    match ADMIN.may_load(deps.storage)? {
        Some(admin) if !admin.is_empty() => {
            passed.push(format!("admin is set ({})", admin));
        }
        _ => {
            failures.push("admin is not set".to_string());
        }
    }

    // 2. Config version must be present and match current
    match CONFIG_VERSION.may_load(deps.storage)? {
        Some(v) if v == CURRENT_CONFIG_VERSION => {
            passed.push(format!("config_version is current ({})", v));
        }
        Some(v) => {
            failures.push(format!(
                "config_version mismatch: stored={}, expected={}",
                v, CURRENT_CONFIG_VERSION
            ));
        }
        None => {
            failures.push("config_version not set".to_string());
        }
    }

    // 3. Treasury balance must be set and non-negative (Uint128 guarantees ≥ 0)
    match TREASURY_BALANCE.may_load(deps.storage)? {
        Some(balance) => {
            passed.push(format!("treasury_balance is initialized ({})", balance));
        }
        None => {
            failures.push("treasury_balance storage key is missing".to_string());
        }
    }

    // 4. No fee balance entries should be negative (Uint128 guarantees this,
    //    but we verify the map is iterable and all values are non-zero if present)
    let fee_entries: Vec<_> = FEE_BALANCES
        .range(deps.storage, None, None, Order::Ascending)
        .collect::<StdResult<Vec<_>>>()?;

    let zero_fee_count = fee_entries.iter().filter(|(_, v)| v.is_zero()).count();
    if zero_fee_count > 0 {
        failures.push(format!(
            "{} fee_balance entries are zero (consider running CleanupStorage)",
            zero_fee_count
        ));
    } else {
        passed.push(format!(
            "fee_balances: {} entries, none are zero",
            fee_entries.len()
        ));
    }

    // 5. No explicitly-revoked role entries should remain (they waste storage)
    let revoked_role_count = AUTHORIZED_ROLES
        .range(deps.storage, None, None, Order::Ascending)
        .filter_map(|item| item.ok())
        .filter(|(_, v)| !v)
        .count();

    if revoked_role_count > 0 {
        failures.push(format!(
            "{} authorized_roles entries are explicitly false (consider running CleanupStorage)",
            revoked_role_count
        ));
    } else {
        passed.push("authorized_roles: no stale revoked entries".to_string());
    }

    let ok = failures.is_empty();
    Ok(SelfCheckResponse { ok, failures, passed })
}
