//! Fixture: Inefficient Bytes Allocation
//!
//! This file demonstrates the anti-patterns that the
//! `soroban-inefficient-bytes-allocation` rule detects.
//! It is **not** compiled into the library — it exists purely as a
//! human-readable reference and as input for integration tests.

#![no_std]
use soroban_sdk::{bytes, contract, contractimpl, Bytes, BytesN, Env};

#[contract]
pub struct InefficientBytesAllocation;

#[contractimpl]
impl InefficientBytesAllocation {
    // ❌ BAD: same Bytes value constructed twice in one function.
    //    Each `Bytes::from_array` call allocates a new host object and burns
    //    metered CPU/memory budget — even when the content is identical.
    pub fn compare_bad(env: Env) -> bool {
        let a = Bytes::from_array(&env, &[1u8, 2, 3, 4]);
        let b = Bytes::from_array(&env, &[1u8, 2, 3, 4]); // ← redundant allocation
        a == b
    }

    // ✅ GOOD: construct once, reuse the binding.
    pub fn compare_good(env: Env) -> bool {
        let data = Bytes::from_array(&env, &[1u8, 2, 3, 4]);
        data == data // trivially true, but only one allocation
    }

    // ❌ BAD: Bytes constructed inside a loop — allocation cost multiplied by
    //    every iteration.
    pub fn hash_loop_bad(env: Env, n: u32) -> u32 {
        let mut total = 0u32;
        for _i in 0..n {
            // Each iteration allocates a fresh host object.
            let chunk = Bytes::from_array(&env, &[0xdeu8, 0xad, 0xbe, 0xef]);
            total += chunk.len();
        }
        total
    }

    // ✅ GOOD: hoist the allocation above the loop.
    pub fn hash_loop_good(env: Env, n: u32) -> u32 {
        let chunk = Bytes::from_array(&env, &[0xdeu8, 0xad, 0xbe, 0xef]); // once
        let mut total = 0u32;
        for _i in 0..n {
            total += chunk.len(); // reuse, no new allocation
        }
        total
    }

    // ❌ BAD: `bytes!` macro used twice with the same literal.
    pub fn macro_repeated_bad(env: Env) -> bool {
        let x: Bytes = bytes!(&env, 0xdeadbeef);
        let y: Bytes = bytes!(&env, 0xdeadbeef); // ← identical, redundant
        x == y
    }

    // ✅ GOOD: assign once, clone only if ownership is required.
    pub fn macro_repeated_good(env: Env) -> bool {
        let x: Bytes = bytes!(&env, 0xdeadbeef);
        x == x
    }

    // ❌ BAD: BytesN constructed multiple times in the same function.
    pub fn bytesn_repeated_bad(env: Env) -> bool {
        let a: BytesN<32> = BytesN::from_array(&env, &[0u8; 32]);
        let b: BytesN<32> = BytesN::from_array(&env, &[0u8; 32]); // ← redundant
        a == b
    }

    // ✅ GOOD: single construction, reuse the binding.
    pub fn bytesn_repeated_good(env: Env) -> bool {
        let a: BytesN<32> = BytesN::from_array(&env, &[0u8; 32]);
        a == a
    }
}
