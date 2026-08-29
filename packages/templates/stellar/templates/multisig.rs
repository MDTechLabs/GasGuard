// Soroban Multi-Signature Wallet Contract Template
//
// A secure M-of-N multisig wallet. Supports proposal creation, signing,
// execution, and revocation. Uses persistent storage for proposals and
// signers so state survives ledger TTL extensions.
//
// Usage: Replace {{CONTRACT_NAME}} with your contract name.

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, Bytes, Env, Vec,
};

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    /// List of authorised signer addresses
    Signers,
    /// Required number of signatures to execute a proposal
    Threshold,
    /// Next proposal ID counter
    NextProposalId,
    /// Proposal data by ID
    Proposal(u64),
    /// Set of signers who have approved a proposal
    Approvals(u64),
}

// ── Data structures ───────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Proposal {
    /// Unique sequential identifier
    pub id: u64,
    /// Target contract address to call
    pub target: Address,
    /// Encoded call data (serialised XDR / bytes)
    pub calldata: Bytes,
    /// Ledger number after which this proposal expires
    pub expiry_ledger: u32,
    /// Whether the proposal has been executed
    pub executed: bool,
    /// Proposer address
    pub proposer: Address,
}

// ── Contract struct ───────────────────────────────────────────────────────────

#[contract]
pub struct {{CONTRACT_NAME}};

// ── Implementation ────────────────────────────────────────────────────────────

#[contractimpl]
impl {{CONTRACT_NAME}} {
    // ─── Lifecycle ────────────────────────────────────────────────────

    /// Initialise the multisig wallet.
    ///
    /// * `signers`   – list of authorised signers (must be unique, ≥ 1).
    /// * `threshold` – number of approvals required (1 ≤ threshold ≤ signers.len()).
    pub fn initialize(env: Env, signers: Vec<Address>, threshold: u32) {
        assert!(
            !env.storage().instance().has(&DataKey::Threshold),
            "already initialized"
        );
        assert!(!signers.is_empty(), "need at least one signer");
        assert!(
            threshold >= 1 && threshold <= signers.len() as u32,
            "threshold out of range"
        );

        // Enforce uniqueness
        for i in 0..signers.len() {
            for j in (i + 1)..signers.len() {
                assert!(signers.get(i) != signers.get(j), "duplicate signer");
            }
        }

        env.storage().instance().set(&DataKey::Signers, &signers);
        env.storage().instance().set(&DataKey::Threshold, &threshold);
        env.storage().instance().set(&DataKey::NextProposalId, &0_u64);
    }

    // ─── Proposal management ──────────────────────────────────────────

    /// Create a new proposal. Caller must be a registered signer.
    ///
    /// Returns the new proposal ID.
    pub fn propose(
        env: Env,
        proposer: Address,
        target: Address,
        calldata: Bytes,
        expiry_ledger: u32,
    ) -> u64 {
        proposer.require_auth();
        Self::assert_is_signer(&env, &proposer);
        assert!(
            expiry_ledger > env.ledger().sequence(),
            "expiry must be in the future"
        );

        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextProposalId)
            .unwrap_or(0);

        let proposal = Proposal {
            id,
            target,
            calldata,
            expiry_ledger,
            executed: false,
            proposer: proposer.clone(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Proposal(id), &proposal);

        // Proposer implicitly approves their own proposal
        let mut approvals: Vec<Address> = Vec::new(&env);
        approvals.push_back(proposer.clone());
        env.storage()
            .persistent()
            .set(&DataKey::Approvals(id), &approvals);

        let next = id.checked_add(1).expect("proposal id overflow");
        env.storage()
            .instance()
            .set(&DataKey::NextProposalId, &next);

        env.events()
            .publish((symbol_short!("propose"), proposer), id);

        id
    }

    /// Approve an existing, non-expired proposal. Caller must be a signer
    /// who has not already approved this proposal.
    pub fn approve(env: Env, signer: Address, proposal_id: u64) {
        signer.require_auth();
        Self::assert_is_signer(&env, &signer);

        let proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .expect("proposal not found");

        assert!(!proposal.executed, "proposal already executed");
        assert!(
            env.ledger().sequence() <= proposal.expiry_ledger,
            "proposal expired"
        );

        let mut approvals: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Approvals(proposal_id))
            .unwrap_or_else(|| Vec::new(&env));

        for existing in approvals.iter() {
            assert!(existing != signer, "already approved");
        }

        approvals.push_back(signer.clone());
        env.storage()
            .persistent()
            .set(&DataKey::Approvals(proposal_id), &approvals);

        env.events()
            .publish((symbol_short!("approve"), signer), proposal_id);
    }

    /// Revoke a previously given approval. Caller must have already approved.
    pub fn revoke(env: Env, signer: Address, proposal_id: u64) {
        signer.require_auth();

        let proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .expect("proposal not found");

        assert!(!proposal.executed, "proposal already executed");

        let approvals: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Approvals(proposal_id))
            .unwrap_or_else(|| Vec::new(&env));

        let mut new_approvals: Vec<Address> = Vec::new(&env);
        let mut found = false;
        for addr in approvals.iter() {
            if addr == signer {
                found = true;
            } else {
                new_approvals.push_back(addr);
            }
        }

        assert!(found, "approval not found");

        env.storage()
            .persistent()
            .set(&DataKey::Approvals(proposal_id), &new_approvals);

        env.events()
            .publish((symbol_short!("revoke"), signer), proposal_id);
    }

    /// Execute a proposal once the threshold is met. Any signer may trigger execution.
    pub fn execute(env: Env, executor: Address, proposal_id: u64) {
        executor.require_auth();
        Self::assert_is_signer(&env, &executor);

        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .expect("proposal not found");

        assert!(!proposal.executed, "proposal already executed");
        assert!(
            env.ledger().sequence() <= proposal.expiry_ledger,
            "proposal expired"
        );

        let approvals: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Approvals(proposal_id))
            .unwrap_or_else(|| Vec::new(&env));

        let threshold: u32 = env
            .storage()
            .instance()
            .get(&DataKey::Threshold)
            .unwrap();

        assert!(
            approvals.len() as u32 >= threshold,
            "insufficient approvals"
        );

        // Mark as executed before external call (re-entrancy guard)
        proposal.executed = true;
        env.storage()
            .persistent()
            .set(&DataKey::Proposal(proposal_id), &proposal);

        // NOTE: Actual cross-contract invocation would be performed here
        // using env.invoke_contract(). Omitted to keep the template generic.

        env.events()
            .publish((symbol_short!("execute"), executor), proposal_id);
    }

    // ─── Read-only getters ────────────────────────────────────────────

    pub fn get_proposal(env: Env, proposal_id: u64) -> Proposal {
        env.storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .expect("proposal not found")
    }

    pub fn get_approvals(env: Env, proposal_id: u64) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::Approvals(proposal_id))
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_signers(env: Env) -> Vec<Address> {
        env.storage().instance().get(&DataKey::Signers).unwrap()
    }

    pub fn get_threshold(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Threshold).unwrap()
    }

    pub fn is_signer(env: Env, address: Address) -> bool {
        let signers: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Signers)
            .unwrap_or_else(|| Vec::new(&env));
        signers.contains(&address)
    }

    // ─── Private helpers ──────────────────────────────────────────────

    fn assert_is_signer(env: &Env, address: &Address) {
        let signers: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Signers)
            .unwrap_or_else(|| Vec::new(env));
        assert!(signers.contains(address), "not a registered signer");
    }
}
