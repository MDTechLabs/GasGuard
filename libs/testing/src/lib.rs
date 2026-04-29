//! GasGuard Rule Testing Framework for Rust/Soroban
//!
//! Provides testing utilities for rule developers including:
//! - Input/output fixtures
//! - Snapshot testing
//! - Rule validation helpers

pub mod fixture;
pub mod runner;
pub mod assertions;

pub use fixture::{RuleFixture, TestSuite};
pub use runner::RuleTestRunner;
pub use assertions::RuleAssertions;
