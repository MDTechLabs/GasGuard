use std::collections::HashMap;

/// Represents the size of a Solidity type in bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TypeSize {
    pub bytes: usize,
    pub bits: usize,
}

impl TypeSize {
    pub const fn new(bytes: usize) -> Self {
        Self {
            bytes,
            bits: bytes * 8,
        }
    }
}

/// A state variable extracted from a contract definition.
#[derive(Debug, Clone)]
pub struct StateVariable {
    pub name: String,
    pub type_name: String,
    pub size: TypeSize,
    pub declared_line: usize,
    pub is_mapping: bool,
    pub is_dynamic_array: bool,
    pub is_packable: bool,
}

/// A storage slot with its index and the variables packed into it.
#[derive(Debug, Clone)]
pub struct StorageSlot {
    pub index: usize,
    pub remaining_bytes: usize,
    pub variables: Vec<StateVariable>,
}

/// The result of an optimal packing computation.
#[derive(Debug, Clone)]
pub struct PackingResult {
    pub slots: Vec<StorageSlot>,
    pub total_slots_used: usize,
    pub total_slots_before: usize,
    pub savings_bytes: usize,
    pub savings_slots: usize,
}

/// Maps Solidity type names to their byte sizes.
pub fn type_size_of(type_name: &str) -> Option<TypeSize> {
    let map: HashMap<&str, usize> = [
        ("bool", 1),
        ("uint8", 1),
        ("int8", 1),
        ("uint16", 2),
        ("int16", 2),
        ("uint32", 4),
        ("int32", 4),
        ("uint64", 8),
        ("int64", 8),
        ("uint128", 16),
        ("int128", 16),
        ("uint256", 32),
        ("int256", 32),
        ("address", 20),
        ("bytes1", 1),
        ("bytes2", 2),
        ("bytes4", 4),
        ("bytes8", 8),
        ("bytes16", 16),
        ("bytes32", 32),
        ("string", 32),
        ("bytes", 32),
    ]
    .into_iter()
    .collect();

    map.get(type_name).copied().map(TypeSize::new)
}

/// Returns true if the type is a mapping (always occupies a full slot and cannot be packed).
pub fn is_mapping_type(type_name: &str) -> bool {
    type_name.starts_with("mapping(")
}

/// Returns true if the type is a dynamic array (cannot be packed with other variables).
pub fn is_dynamic_array_type(type_name: &str) -> bool {
    type_name.ends_with("[]") && !type_name.starts_with("bytes") && !type_name.starts_with("string")
}

/// Classifies a state variable by its packability.
pub fn classify_variable(name: &str, type_name: &str, line: usize) -> StateVariable {
    let size = type_size_of(type_name).unwrap_or(TypeSize::new(32));
    let is_mapping = is_mapping_type(type_name);
    let is_dynamic_array = is_dynamic_array_type(type_name);
    let is_packable = !is_mapping && !is_dynamic_array && size.bytes < 32;

    StateVariable {
        name: name.to_string(),
        type_name: type_name.to_string(),
        size,
        declared_line: line,
        is_mapping,
        is_dynamic_array,
        is_packable,
    }
}

/// Simulates EVM storage slot packing using a first-fit decreasing algorithm.
///
/// EVM storage slots are 256-bit (32 bytes). Variables that fit within a single
/// slot can be packed together. Mappings and dynamic arrays each occupy a full slot.
pub fn compute_optimal_packing(variables: &[StateVariable]) -> PackingResult {
    let total_slots_before = variables.len();

    let mut slots: Vec<StorageSlot> = Vec::new();
    let mut unplaced: Vec<StateVariable> = Vec::new();

    // Separate packable variables from slot-consuming ones (mappings, dynamic arrays, uint256).
    let mut packable: Vec<StateVariable> = Vec::new();
    for var in variables {
        if var.is_mapping || var.is_dynamic_array {
            // These consume an entire slot.
            slots.push(StorageSlot {
                index: slots.len(),
                remaining_bytes: 0,
                variables: vec![var.clone()],
            });
        } else if var.size.bytes == 32 {
            // Full-slot types like uint256, bytes32, address (20 bytes fits in a slot).
            // address is 20 bytes and can be packed with other small types.
            if var.size.bytes == 32 {
                slots.push(StorageSlot {
                    index: slots.len(),
                    remaining_bytes: 0,
                    variables: vec![var.clone()],
                });
            } else {
                packable.push(var.clone());
            }
        } else {
            packable.push(var.clone());
        }
    }

    // Sort packable variables by size descending for first-fit decreasing.
    packable.sort_by(|a, b| b.size.bytes.cmp(&a.size.bytes));

    // First-fit decreasing bin packing into 32-byte slots.
    for var in &packable {
        let mut placed = false;
        for slot in &mut slots {
            if slot.remaining_bytes >= var.size.bytes && !slot.variables.is_empty() {
                // Check that we don't mix packable with full-slot consumers.
                let has_full_slot_var = slot.variables.iter().any(|v| {
                    v.is_mapping || v.is_dynamic_array || v.size.bytes == 32
                });
                if !has_full_slot_var {
                    slot.variables.push(var.clone());
                    slot.remaining_bytes -= var.size.bytes;
                    placed = true;
                    break;
                }
            }
        }
        if !placed {
            slots.push(StorageSlot {
                index: slots.len(),
                remaining_bytes: 32 - var.size.bytes,
                variables: vec![var.clone()],
            });
        }
    }

    let total_slots_used = slots.len();
    let savings_slots = total_slots_before.saturating_sub(total_slots_used);
    let savings_bytes = savings_slots * 32;

    PackingResult {
        slots,
        total_slots_used,
        total_slots_before,
        savings_bytes,
        savings_slots,
    }
}

/// Formats a storage slot visual map for terminal output.
pub fn format_slot_visual(result: &PackingResult) -> String {
    let mut output = String::new();
    output.push_str(&format!(
        "\n  Storage Slot Layout ({} slots used, {} saved from {} before)\n",
        result.total_slots_used, result.savings_slots, result.total_slots_before
    ));
    output.push_str(&format!(
        "  Slot savings: {} slots ({} bytes)\n",
        result.savings_slots, result.savings_bytes
    ));
    output.push_str("  ──────────────────────────────────────────────────────────\n");

    for slot in &result.slots {
        let used = 32 - slot.remaining_bytes;
        let bar_len = (used as f64 / 32.0 * 40.0) as usize;
        let bar = "█".repeat(bar_len);
        let pad = " ".repeat(40 - bar_len);

        output.push_str(&format!(
            "  Slot {:>3} [{}]{} {} bytes used\n",
            slot.index,
            bar,
            pad,
            used
        ));

        for var in &slot.variables {
            output.push_str(&format!(
                "    ├── {} ({}) {} bytes\n",
                var.name, var.type_name, var.size.bytes
            ));
        }
    }

    output.push_str("  ──────────────────────────────────────────────────────────\n");
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn type_size_of_known_types() {
        assert_eq!(type_size_of("uint256").unwrap().bytes, 32);
        assert_eq!(type_size_of("uint8").unwrap().bytes, 1);
        assert_eq!(type_size_of("address").unwrap().bytes, 20);
        assert_eq!(type_size_of("bool").unwrap().bytes, 1);
        assert_eq!(type_size_of("bytes32").unwrap().bytes, 32);
        assert_eq!(type_size_of("uint128").unwrap().bytes, 16);
    }

    #[test]
    fn type_size_of_unknown_type_defaults_32() {
        let size = type_size_of("MyCustomType").unwrap_or(TypeSize::new(32));
        assert_eq!(size.bytes, 32);
    }

    #[test]
    fn classify_packable_variable() {
        let var = classify_variable("flag", "bool", 5);
        assert!(var.is_packable);
        assert_eq!(var.size.bytes, 1);
        assert!(!var.is_mapping);
        assert!(!var.is_dynamic_array);
    }

    #[test]
    fn classify_mapping_is_not_packable() {
        let var = classify_variable("balances", "mapping(address => uint256)", 6);
        assert!(!var.is_packable);
        assert!(var.is_mapping);
    }

    #[test]
    fn classify_dynamic_array_is_not_packable() {
        let var = classify_variable("ids", "uint256[]", 7);
        assert!(!var.is_packable);
        assert!(var.is_dynamic_array);
    }

    #[test]
    fn compute_optimal_packing_basic() {
        let vars = vec![
            classify_variable("flag1", "bool", 1),
            classify_variable("flag2", "bool", 2),
            classify_variable("count", "uint16", 3),
            classify_variable("user", "address", 4),
            classify_variable("balance", "uint256", 5),
        ];

        let result = compute_optimal_packing(&vars);
        // flag1(1) + flag2(1) + count(2) + user(20) = 24 bytes -> fits in 1 slot
        // balance(32) -> needs 1 slot
        // Total: 2 slots instead of 5 = 3 slots saved
        assert_eq!(result.total_slots_used, 2);
        assert_eq!(result.savings_slots, 3);
        assert_eq!(result.savings_bytes, 96);
    }

    #[test]
    fn compute_optimal_packing_no_savings() {
        let vars = vec![
            classify_variable("a", "uint256", 1),
            classify_variable("b", "uint256", 2),
        ];

        let result = compute_optimal_packing(&vars);
        assert_eq!(result.total_slots_used, 2);
        assert_eq!(result.savings_slots, 0);
    }

    #[test]
    fn format_slot_visual_contains_slot_info() {
        let vars = vec![
            classify_variable("flag", "bool", 1),
            classify_variable("balance", "uint256", 2),
        ];
        let result = compute_optimal_packing(&vars);
        let visual = format_slot_visual(&result);
        assert!(visual.contains("Slot"));
        assert!(visual.contains("flag"));
        assert!(visual.contains("balance"));
    }
}