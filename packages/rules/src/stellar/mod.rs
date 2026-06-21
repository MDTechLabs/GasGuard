//! Stellar-specific analysis and linting module
//!
//! This module provides Stellar and Soroban-specific analysis capabilities

pub mod linting;
pub mod unsafe_operations;
pub mod upgradeability;

pub use linting::*;
pub use unsafe_operations::*;
pub use upgradeability::*;
