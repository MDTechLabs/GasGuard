use cosmwasm_schema::{cw_serde, QueryResponses};
use cosmwasm_std::Uint128;

#[cw_serde]
pub struct Auth {
    pub nonce: u64,
    pub expires_at: Option<u64>,
    /// Optional unique transaction ID for hash-based replay protection (#137).
    /// When provided, the contract rejects any second submission with the same ID.
    pub tx_id: Option<String>,
}

#[cw_serde]
pub struct InstantiateMsg {
    pub admin: Option<String>,
}

/// #135 — Sent during `migrate` entry-point calls.
#[cw_serde]
pub struct MigrateMsg {
    /// Target schema version. Must equal CURRENT_CONFIG_VERSION.
    pub target_version: u32,
}

#[cw_serde]
pub enum ExecuteMsg {
    SetMetadata {
        token_id: String,
        metadata: PropertyMetadata,
        auth: Auth,
    },
    UpdateMetadata {
        token_id: String,
        metadata: PropertyMetadata,
        auth: Auth,
    },
    Batch {
        msgs: Vec<BatchMsg>,
        auth: Auth,
    },

    // #138 Fee Withdrawal Security — now requires auth for replay protection (#137)
    WithdrawFees {
        recipient: String,
        amount: Uint128,
        token: String,
        auth: Auth,
    },

    // #139 Treasury Management — now requires auth for replay protection (#137)
    TreasuryAction {
        action: TreasuryAction,
        auth: Auth,
    },

    // Role-based Access Control
    UpdateConfig {
        new_admin: Option<String>,
        authorized_roles: Option<Vec<(String, bool)>>,
    },

    // #136 — Storage Cleanup: prune stale/zero-balance records (admin-only)
    CleanupStorage {},
}

#[cw_serde]
pub enum TreasuryAction {
    Deposit { amount: Uint128 },
    Withdraw { amount: Uint128, recipient: String },
    Transfer { amount: Uint128, recipient: String },
}

#[cw_serde]
pub enum BatchMsg {
    SetMetadata {
        token_id: String,
        metadata: PropertyMetadata,
    },
    UpdateMetadata {
        token_id: String,
        metadata: PropertyMetadata,
    },
}

#[cw_serde]
pub struct PropertyMetadata {
    pub name: String,
    pub description: String,
    pub image_url: Option<String>,
}

// ── Query types (#132) ────────────────────────────────────────────────────────

#[cw_serde]
#[derive(QueryResponses)]
pub enum QueryMsg {
    /// #132 — Validate internal state invariants (read-only, no side effects).
    #[returns(SelfCheckResponse)]
    SelfCheck {},
}

/// #132 — Result of the self-check routine.
#[cw_serde]
pub struct SelfCheckResponse {
    /// `true` if every invariant passes.
    pub ok: bool,
    /// Human-readable descriptions of failed invariants (empty when ok).
    pub failures: Vec<String>,
    /// Human-readable descriptions of passed invariants.
    pub passed: Vec<String>,
}

/// #136 — Cleanup operation summary emitted as response attributes.
#[cw_serde]
pub struct CleanupStats {
    pub zero_fee_records_removed: u64,
    pub revoked_roles_removed: u64,
}
