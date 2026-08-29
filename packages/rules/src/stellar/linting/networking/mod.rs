//! Stellar Network Validation Rules
//!
//! Rules that detect missing network/environment validation in Soroban contracts.
//! Contracts may behave incorrectly across different Stellar networks (mainnet, testnet, futurenet)
//! if they don't validate the network passphrase or environment.

pub mod network_validation;

pub use network_validation::*;
