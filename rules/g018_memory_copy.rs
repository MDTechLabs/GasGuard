//! Rule G018: Flag Memory Array Copy Loops That Can Be Replaced with MCOPY.

pub struct RuleG018MemoryCopy;

impl RuleG018MemoryCopy {
    pub fn name() -> &'static str {
        "G018_memory_copy"
    }

    pub fn check(source_code: &str) -> Vec<String> {
        let mut warnings = Vec::new();

        // Detect for/while loops that manually copy memory array elements.
        // These patterns indicate element-by-element copying that MCOPY could handle.
        let has_loop = source_code.contains("for (")
            || source_code.contains("while (");
        let has_memory_write = source_code.contains("mstore(");

        if has_loop && has_memory_write {
            // Check for patterns: reading from one memory region, writing to another.
            let has_mload = source_code.contains("mload(");
            let has_loop_var = source_code.contains(" i ")
                || source_code.contains("uint i")
                || source_code.contains("uint256 i");

            if has_mload && has_loop_var {
                warnings.push(
                    "Optimization: Memory array copy loop detected. "
                        .to_string()
                        + "Consider replacing element-by-element mload/mstore loop with "
                        + "the native MCOPY opcode (EVM Cancun) for significant gas savings.",
                );
            }
        }

        // Additional check: plain Solidity memory array copies in loops.
        if has_loop {
            // Look for patterns like: arr[i] = other[i] inside a loop body.
            let has_array_copy = source_code.contains(" = ")
                && (source_code.contains("[i]") || source_code.contains("[j]"));
            if has_array_copy && source_code.contains("memory") {
                warnings.push(
                    "Optimization: Solidity memory array element-by-element copy loop detected. "
                        .to_string()
                        + "Consider using inline assembly with mcopy or targeting EVM version "
                        + "'cancun' to leverage the native MCOPY opcode.",
                );
            }
        }

        warnings
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_g018_flags_memory_copy_in_assembly_loop() {
        let code = r#"
            for (uint i = 0; i < len; i++) {
                mstore(dst, mload(src));
                dst += 32;
                src += 32;
            }
        "#;
        let warnings = RuleG018MemoryCopy::check(code);
        assert!(!warnings.is_empty());
        assert!(warnings[0].contains("MCOPY"));
    }

    #[test]
    fn test_g018_flags_solidity_memory_array_copy() {
        let code = r#"
            uint[] memory a = new uint[](n);
            uint[] memory b = new uint[](n);
            for (uint i = 0; i < n; i++) {
                b[i] = a[i];
            }
        "#;
        let warnings = RuleG018MemoryCopy::check(code);
        assert!(!warnings.is_empty());
    }

    #[test]
    fn test_g018_no_warning_for_storage_arrays() {
        let code = r#"
            for (uint i = 0; i < n; i++) {
                storageArr[i] = storageArr2[i];
            }
        "#;
        let warnings = RuleG018MemoryCopy::check(code);
        // Should not flag storage arrays since MCOPY only applies to memory.
        assert!(warnings.is_empty());
    }

    #[test]
    fn test_g018_no_warning_for_non_copy_loops() {
        let code = r#"
            for (uint i = 0; i < n; i++) {
                sum += arr[i];
            }
        "#;
        let warnings = RuleG018MemoryCopy::check(code);
        assert!(warnings.is_empty());
    }
}
