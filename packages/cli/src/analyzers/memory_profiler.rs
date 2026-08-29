//! EVM memory allocation profiler.
//!
//! Tracks how far a function pushes the free memory pointer (the word at
//! `0x40`) over the course of its execution and flags functions whose
//! cumulative allocations trip the EVM's quadratic memory-expansion cost:
//!
//! ```text
//! C_mem(a) = 3a + a^2 / 512
//! ```
//!
//! where `a` is memory size in 32-byte words. Because the second term grows
//! quadratically, large single allocations (or many small ones inside a
//! loop) can produce gas spikes that are easy to miss when eyeballing
//! Solidity source. This module gives GasGuard's static/dynamic analysis
//! passes a way to compute that cost ahead of deployment.

use std::collections::HashMap;

/// EVM word size in bytes.
const EVM_WORD_SIZE: u64 = 32;

/// Solidity's conventional starting free-memory-pointer value: the two
/// reserved scratch words (`0x00`-`0x3f`) plus the `0x40` slot itself.
const INITIAL_FREE_MEMORY_OFFSET: u64 = 0x80;

/// Allocations pushing a function's cumulative footprint past this many
/// bytes are flagged as a critical quadratic-expansion risk.
pub const CRITICAL_ALLOCATION_THRESHOLD_BYTES: u64 = 1024;

/// Severity of a memory-profiling finding.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemorySeverity {
    Info,
    Warning,
    Critical,
}

/// A single recorded free-memory-pointer bump.
#[derive(Debug, Clone)]
pub struct MemoryAllocation {
    pub function_name: String,
    pub size_bytes: u64,
    /// Free-memory-pointer value immediately after this allocation.
    pub cumulative_offset: u64,
}

/// A flagged function whose memory footprint is expensive or risky.
#[derive(Debug, Clone)]
pub struct MemoryWarning {
    pub function_name: String,
    pub severity: MemorySeverity,
    pub allocated_bytes: u64,
    pub expansion_gas_cost: u64,
    pub message: String,
}

/// Tracks free-memory-pointer growth across a sequence of allocation steps
/// (a static walk of a function's allocation sites, or a dynamic execution
/// trace) and computes EVM memory-expansion gas costs from it.
#[derive(Debug, Default)]
pub struct MemoryProfiler {
    free_memory_pointer: u64,
    allocations: Vec<MemoryAllocation>,
}

impl MemoryProfiler {
    pub fn new() -> Self {
        Self {
            free_memory_pointer: INITIAL_FREE_MEMORY_OFFSET,
            allocations: Vec::new(),
        }
    }

    /// Computes `C_mem(a) = 3a + a^2 / 512` for a region of `size_bytes`,
    /// rounding up to a whole number of 32-byte words first.
    pub fn memory_expansion_gas_cost(size_bytes: u64) -> u64 {
        let words = Self::bytes_to_words(size_bytes);
        3 * words + (words * words) / 512
    }

    fn bytes_to_words(size_bytes: u64) -> u64 {
        (size_bytes + EVM_WORD_SIZE - 1) / EVM_WORD_SIZE
    }

    /// Records the free memory pointer advancing by `size_bytes` for
    /// `function_name`, simulating a single allocation step. Returns the
    /// *marginal* gas cost of this specific expansion (the quadratic
    /// formula evaluated at the new high-water mark minus at the old one),
    /// which is what the EVM actually charges per `MSTORE`/`CALLDATACOPY`
    /// touching new memory.
    pub fn record_allocation(&mut self, function_name: &str, size_bytes: u64) -> u64 {
        let cost_before = Self::memory_expansion_gas_cost(self.active_bytes());
        self.free_memory_pointer += size_bytes;
        let cost_after = Self::memory_expansion_gas_cost(self.active_bytes());

        self.allocations.push(MemoryAllocation {
            function_name: function_name.to_string(),
            size_bytes,
            cumulative_offset: self.free_memory_pointer,
        });

        cost_after.saturating_sub(cost_before)
    }

    /// Bytes actively allocated so far (free memory pointer minus its
    /// starting offset).
    pub fn active_bytes(&self) -> u64 {
        self.free_memory_pointer - INITIAL_FREE_MEMORY_OFFSET
    }

    /// All allocation steps recorded so far.
    pub fn allocations(&self) -> &[MemoryAllocation] {
        &self.allocations
    }

    /// Aggregates recorded allocations per function and flags any whose
    /// total footprint exceeds {CRITICAL_ALLOCATION_THRESHOLD_BYTES}.
    pub fn flag_warnings(&self) -> Vec<MemoryWarning> {
        let mut totals: HashMap<&str, u64> = HashMap::new();
        for allocation in &self.allocations {
            *totals.entry(allocation.function_name.as_str()).or_insert(0) += allocation.size_bytes;
        }

        let mut warnings: Vec<MemoryWarning> = totals
            .into_iter()
            .filter(|(_, total_bytes)| *total_bytes > CRITICAL_ALLOCATION_THRESHOLD_BYTES)
            .map(|(function_name, total_bytes)| MemoryWarning {
                function_name: function_name.to_string(),
                severity: MemorySeverity::Critical,
                allocated_bytes: total_bytes,
                expansion_gas_cost: Self::memory_expansion_gas_cost(total_bytes),
                message: format!(
                    "function '{function_name}' allocates {total_bytes} bytes of memory (> {CRITICAL_ALLOCATION_THRESHOLD_BYTES} byte threshold); quadratic memory expansion may cause unexpected gas spikes"
                ),
            })
            .collect();

        warnings.sort_by(|a, b| b.allocated_bytes.cmp(&a.allocated_bytes));
        warnings
    }

    /// Resets the profiler to analyze a fresh execution/function.
    pub fn reset(&mut self) {
        self.free_memory_pointer = INITIAL_FREE_MEMORY_OFFSET;
        self.allocations.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formula_matches_known_checkpoints() {
        // a = 0 words -> 0 gas.
        assert_eq!(MemoryProfiler::memory_expansion_gas_cost(0), 0);
        // a = 1 word (32 bytes) -> 3*1 + 1/512 = 3.
        assert_eq!(MemoryProfiler::memory_expansion_gas_cost(32), 3);
        // a = 32 words (1024 bytes) -> 3*32 + 32*32/512 = 96 + 2 = 98.
        assert_eq!(MemoryProfiler::memory_expansion_gas_cost(1024), 98);
        // a = 512 words (16384 bytes) -> 3*512 + 512*512/512 = 1536 + 512 = 2048.
        assert_eq!(MemoryProfiler::memory_expansion_gas_cost(16384), 2048);
    }

    #[test]
    fn record_allocation_returns_marginal_cost() {
        let mut profiler = MemoryProfiler::new();

        // First 32-byte allocation from an empty state costs C_mem(32) - C_mem(0) = 3.
        let first = profiler.record_allocation("transfer", 32);
        assert_eq!(first, 3);
        assert_eq!(profiler.active_bytes(), 32);

        // A second word-sized allocation costs C_mem(64) - C_mem(32) = 6 - 3 = 3.
        let second = profiler.record_allocation("transfer", 32);
        assert_eq!(second, 3);
        assert_eq!(profiler.active_bytes(), 64);
    }

    #[test]
    fn flags_functions_over_the_critical_threshold() {
        let mut profiler = MemoryProfiler::new();
        profiler.record_allocation("batchProcess", 2048);
        profiler.record_allocation("readOnly", 64);

        let warnings = profiler.flag_warnings();
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].function_name, "batchProcess");
        assert_eq!(warnings[0].severity, MemorySeverity::Critical);
        assert_eq!(warnings[0].allocated_bytes, 2048);
    }

    #[test]
    fn does_not_flag_functions_within_threshold() {
        let mut profiler = MemoryProfiler::new();
        profiler.record_allocation("smallBuffer", 512);

        assert!(profiler.flag_warnings().is_empty());
    }

    #[test]
    fn aggregates_multiple_allocations_for_the_same_function() {
        let mut profiler = MemoryProfiler::new();
        profiler.record_allocation("loopAppend", 600);
        profiler.record_allocation("loopAppend", 600);

        let warnings = profiler.flag_warnings();
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].allocated_bytes, 1200);
    }

    #[test]
    fn reset_clears_state() {
        let mut profiler = MemoryProfiler::new();
        profiler.record_allocation("f", 2048);
        profiler.reset();

        assert_eq!(profiler.active_bytes(), 0);
        assert!(profiler.allocations().is_empty());
        assert!(profiler.flag_warnings().is_empty());
    }
}
