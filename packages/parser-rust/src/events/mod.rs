//! Soroban contract event parsing and decoding.
//!
//! This module contains:
//! - [`decoder`] — core decoding logic (topics, payloads, XDR values)
//! - [`formatter`] — human-readable and structured output formats

pub mod decoder;
pub mod formatter;
