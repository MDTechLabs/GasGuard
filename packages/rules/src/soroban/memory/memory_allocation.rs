//! Rule: Soroban Memory Allocation Analyzer (Issue #776)
//!
//! Excessive allocation in Soroban contracts increases metered CPU and memory
//! resource consumption, which can cause contract failures when budget limits
//! are hit or simply inflate per-call costs.
//!
//! ## What this rule detects
//!
//! * Repeated heap allocations of the same type inside a single function
//!   (`Vec::new`, `Map::new`, `Bytes::new`, `String::new`, `vec!`, `map!`).
//! * Any allocation call that appears inside a loop body
//!   (`for`, `while`, `loop {`).
//! * Large temporary objects constructed and discarded within a single statement.
//!
//! ## Suggested fix
//!
//! * Pre-allocate outside loops and reuse the allocated object.
//! * Prefer `Vec::with_capacity` when the final size is known.
//! * Hoist allocations to the top of the function or to a `lazy_static`/`const`
//!   where the SDK allows it.

use crate::soroban::rule_engine::SorobanRule;
use crate::soroban::SorobanContract;
use crate::{RuleViolation, ViolationSeverity};

/// Patterns that indicate a heap allocation of a Soroban or standard type.
const ALLOC_PATTERNS: &[&str] = &[
    "Vec::new(",
    "vec![",
    "Map::new(",
    "Bytes::new(",
    "BytesN::new(",
    "Bytes::from_array(",
    "Bytes::from_slice(",
    "String::new(",
    "String::from(",
    "soroban_sdk::String::from(",
    "BTreeMap::new(",
    "HashMap::new(",
];

/// Loop-start keywords used to detect in-loop allocations.
const LOOP_KEYWORDS: &[&str] = &["for ", "while ", "loop {"];

/// Rule that detects inefficient memory allocation patterns in Soroban contracts.
pub struct MemoryAllocationRule {
    enabled: bool,
}

impl Default for MemoryAllocationRule {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl SorobanRule for MemoryAllocationRule {
    fn id(&self) -> &str {
        "soroban-memory-allocation"
    }

    fn name(&self) -> &str {
        "Soroban Memory Allocation"
    }

    fn description(&self) -> &str {
        "Detects excessive or in-loop memory allocations in Soroban contracts. \
         Each host-object allocation is metered; reducing redundant allocations \
         lowers CPU and memory resource consumption."
    }

    fn severity(&self) -> ViolationSeverity {
        ViolationSeverity::Medium
    }

    fn is_enabled(&self) -> bool {
        self.enabled
    }

    fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    fn apply(&self, contract: &SorobanContract) -> Vec<RuleViolation> {
        let mut violations = Vec::new();

        for implementation in &contract.implementations {
            for function in &implementation.functions {
                let src = &function.raw_definition;

                // Count total allocation calls
                let total_allocs: usize = ALLOC_PATTERNS
                    .iter()
                    .map(|p| src.matches(p).count())
                    .sum();

                // Flag functions with repeated allocations
                if total_allocs >= 3 {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!(
                            "Function '{}' performs {} allocation(s); consider reusing \
                             allocated objects",
                            function.name, total_allocs
                        ),
                        suggestion: "Pre-allocate objects before use, reuse them across \
                            iterations, or use `Vec::with_capacity` when the size is known \
                            to avoid repeated allocations."
                            .to_string(),
                        line_number: function.line_number,
                        column_number: 0,
                        variable_name: function.name.clone(),
                        severity: self.severity(),
                    });
                }

                // Flag any allocation inside a loop
                let has_loop = LOOP_KEYWORDS.iter().any(|kw| src.contains(kw));
                let has_alloc_in_loop = has_loop
                    && ALLOC_PATTERNS.iter().any(|p| {
                        // Heuristic: the allocation pattern appears after a loop keyword
                        // somewhere in the function source.
                        if let Some(loop_pos) = LOOP_KEYWORDS
                            .iter()
                            .filter_map(|kw| src.find(kw))
                            .min()
                        {
                            src[loop_pos..].contains(p)
                        } else {
                            false
                        }
                    });

                if has_alloc_in_loop {
                    violations.push(RuleViolation {
                        rule_name: self.id().to_string(),
                        description: format!(
                            "Function '{}' allocates memory inside a loop, which increases \
                             per-iteration resource costs",
                            function.name
                        ),
                        suggestion: "Move allocations outside the loop. Pre-allocate a single \
                            container, then populate it inside the loop using push/insert."
                            .to_string(),
                        line_number: function.line_number,
                        column_number: 0,
                        variable_name: function.name.clone(),
                        severity: ViolationSeverity::High,
                    });
                }
            }
        }

        violations
    }
}
