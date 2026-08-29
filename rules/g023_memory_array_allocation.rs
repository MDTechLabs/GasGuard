//! Rule G023: Flag Unused Capacity Allocations in Memory Arrays.
//!
//! Detects memory array declarations initialized with large fixed sizes
//! that are only partially populated during execution, which wastes gas
//! on unnecessary memory expansion.

pub struct RuleG023MemoryArrayAllocation;

impl RuleG023MemoryArrayAllocation {
    pub fn name() -> &'static str {
        "G023_memory_array_allocation"
    }

    pub fn check(source_code: &str) -> Vec<String> {
        let mut warnings = Vec::new();

        for line in source_code.lines() {
            let trimmed = line.trim();
            if !trimmed.starts_with("//") && trimmed.contains("new uint") && trimmed.contains("[]")
            {
                let has_loop = source_code.contains("for (")
                    || source_code.contains("while (")
                    || source_code.contains("do {");
                if !has_loop {
                    warnings.push(
                        "Warning: Memory array allocated with size without corresponding \
                         population loop; consider resizing to match actual usage"
                            .to_string(),
                    );
                }
            }
        }

        warnings
    }
}
