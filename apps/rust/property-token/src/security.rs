use cosmwasm_std::{Env, MessageInfo, StdError, StdResult};
use crate::state::{NEXT_NONCE, PROCESSED_TX_IDS};

/// #137 — Replay Attack Protection
///
/// Validates that an incoming transaction is:
/// 1. Not expired (if `expires_at` is set)
/// 2. Not a replayed nonce (sequential per-sender nonce)
/// 3. Not a replayed tx_id (optional hash/ID deduplication)
///
/// On success increments the sender's nonce and marks `tx_id` as processed.
/// Does NOT modify any other state.
pub fn prevent_replay(
    deps: &mut cosmwasm_std::DepsMut,
    env: &Env,
    info: &MessageInfo,
    nonce: u64,
    expires_at: Option<u64>,
    tx_id: Option<&str>,
) -> StdResult<()> {
    let sender = info.sender.as_str();

    // 1. Expiration check
    if let Some(expiry) = expires_at {
        if env.block.time.seconds() > expiry {
            return Err(StdError::generic_err(
                "SignatureExpired: Meta-transaction signature has expired.",
            ));
        }
    }

    // 2. Sequential nonce check (per sender)
    let current_nonce = NEXT_NONCE.may_load(deps.storage, sender)?.unwrap_or(0);
    if nonce < current_nonce {
        return Err(StdError::generic_err("ReplayDetected: Nonce already used."));
    }
    if nonce > current_nonce {
        return Err(StdError::generic_err(
            "OutOfOrderTransaction: Received nonce higher than expected.",
        ));
    }
    NEXT_NONCE.save(deps.storage, sender, &(current_nonce + 1))?;

    // 3. Optional tx_id deduplication — prevents replaying the same signed payload
    //    even if a nonce could theoretically be reused across different tx paths.
    if let Some(id) = tx_id {
        if PROCESSED_TX_IDS.may_load(deps.storage, id)?.unwrap_or(false) {
            return Err(StdError::generic_err(
                "ReplayDetected: Transaction ID already processed.",
            ));
        }
        PROCESSED_TX_IDS.save(deps.storage, id, &true)?;
    }

    Ok(())
}

pub fn ensure_authorized(
    deps: &cosmwasm_std::Deps,
    info: &MessageInfo,
) -> StdResult<()> {
    let sender = info.sender.as_str();
    let is_authorized = crate::state::AUTHORIZED_ROLES
        .may_load(deps.storage, sender)?
        .unwrap_or(false);
    let admin = crate::state::ADMIN.load(deps.storage)?;

    if sender != admin && !is_authorized {
        return Err(StdError::generic_err(
            "Unauthorized: Role-based access control restriction.",
        ));
    }

    Ok(())
}
