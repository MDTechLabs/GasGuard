//! GasGuard Parser — Soroban contract event decoder and parser utilities.
//!
//! This crate provides utilities for decoding raw Stellar/Soroban contract
//! events into human-readable, audit-friendly representations.
//!
//! # Quick start
//!
//! ```rust
//! use gasguard_parser::events::decoder::{EventDecoder, RawSorobanEvent};
//!
//! let raw = RawSorobanEvent {
//!     contract_id: Some("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM".into()),
//!     topics: vec![
//!         "AAAADwAAAAh0cmFuc2Zlcg==".into(),   // Symbol("transfer")
//!         "AAAAEgAAAAFhZG1pbg==".into(),        // Address
//!     ],
//!     data: "AAAACgAAAAAAAAAAAAAAAAAAAAo=".into(), // i128(10)
//!     event_type: "contract".into(),
//!     ledger: 1234,
//!     ledger_closed_at: "2026-01-01T00:00:00Z".into(),
//!     tx_hash: "abc123".into(),
//! };
//!
//! let decoder = EventDecoder::new();
//! let decoded = decoder.decode(&raw).unwrap();
//! println!("{}", decoded.format_pretty());
//! ```

pub mod events;

pub use events::decoder::{
    DecodedEvent, DecodedValue, EventDecoder, EventDecodeError, RawSorobanEvent,
};
pub use events::formatter::{EventFormatter, OutputFormat};
