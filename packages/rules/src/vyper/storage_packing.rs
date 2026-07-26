use crate::rule_engine::{RuleViolation, ViolationSeverity};
use crate::vyper::VyperRule;
use crate::vyper::parser::VyperContract;
use serde::{Deserialize, Serialize};

/// Represents a struct field with its type and size information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StructField {
    pub name: String,
    pub type_name: String,
    pub size_bytes: usize,
    pub line_number: usize,
}

/// Represents a storage packing opportunity in a struct
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StructPackingOpportunity {
    pub struct_name: String,
    pub fields: Vec<StructField>,
    pub current_slots: usize,
    pub optimal_slots: usize,
    pub saved_slots: usize,
    pub reordered_fields: Vec<StructField>,
    pub suggestion: String,
}

/// Get the size of a Vyper type in bytes
pub fn get_vyper_type_size(type_name: &str) -> usize {
    let base_type = type_name.trim().to_lowercase();

    if base_type.starts_with("uint") {
        if let Some(bits_str) = base_type.strip_prefix("uint") {
            if bits_str.is_empty() {
                return 32;
            }
            if let Ok(bits) = bits_str.parse::<usize>() {
                return bits / 8;
            }
        }
    }

    if base_type.starts_with("int") {
        if let Some(bits_str) = base_type.strip_prefix("int") {
            if bits_str.is_empty() {
                return 32;
            }
            if let Ok(bits) = bits_str.parse::<usize>() {
                return bits / 8;
            }
        }
    }

    match base_type.as_str() {
        "bool" => 1,
        "address" => 20,
        "bytes1" | "byte" => 1,
        "bytes2" => 2,
        "bytes3" => 3,
        "bytes4" => 4,
        "bytes5" => 5,
        "bytes6" => 6,
        "bytes7" => 7,
        "bytes8" => 8,
        "bytes9" => 9,
        "bytes10" => 10,
        "bytes11" => 11,
        "bytes12" => 12,
        "bytes13" => 13,
        "bytes14" => 14,
        "bytes15" => 15,
        "bytes16" => 16,
        "bytes17" => 17,
        "bytes18" => 18,
        "bytes19" => 19,
        "bytes20" => 20,
        "bytes21" => 21,
        "bytes22" => 22,
        "bytes23" => 23,
        "bytes24" => 24,
        "bytes25" => 25,
        "bytes26" => 26,
        "bytes27" => 27,
        "bytes28" => 28,
        "bytes29" => 29,
        "bytes30" => 30,
        "bytes31" => 31,
        "bytes32" => 32,
        "string" => 32,
        "decimal" => 32,
        _ => {
            if base_type.contains("[]") || base_type.contains("[") {
                return 32;
            }
            32
        }
    }
}

/// Check if a Vyper type can be packed (sub-256-bit)
pub fn is_vyper_packable_type(type_name: &str) -> bool {
    let base_type = type_name.trim().to_lowercase();

    if base_type.contains("[]")
        || base_type.contains("[")
        || base_type == "string"
        || base_type == "decimal"
    {
        return false;
    }

    let size = get_vyper_type_size(type_name);
    size < 32
}

/// Calculate storage slots for a given field ordering
pub fn calculate_storage_slots(fields: &[crate::vyper::parser::VyperStructField]) -> usize {
    let mut slot_size = 0u32;
    let mut slots = 1usize;

    for field in fields {
        let size = get_vyper_type_size(&field.type_name);
        if size >= 32 {
            slots += 1;
            slot_size = 0;
        } else {
            slot_size += size as u32;
            if slot_size > 32 {
                slots += 1;
                slot_size = size as u32;
            }
        }
    }

    slots
}

/// Find the optimal ordering of fields to minimize storage slots
pub fn find_optimal_ordering(
    fields: &[crate::vyper::parser::VyperStructField],
) -> Vec<crate::vyper::parser::VyperStructField> {
    if fields.is_empty() {
        return Vec::new();
    }

    let mut packable: Vec<crate::vyper::parser::VyperStructField> = fields
        .iter()
        .filter(|f| is_vyper_packable_type(&f.type_name))
        .cloned()
        .collect();
    let mut non_packable: Vec<crate::vyper::parser::VyperStructField> = fields
        .iter()
        .filter(|f| !is_vyper_packable_type(&f.type_name))
        .cloned()
        .collect();

    packable.sort_by(|a, b| {
        let size_a = get_vyper_type_size(&a.type_name);
        let size_b = get_vyper_type_size(&b.type_name);
        size_b.cmp(&size_a)
    });

    let mut slots: Vec<Vec<crate::vyper::parser::VyperStructField>> = Vec::new();

    for field in packable {
        let size = get_vyper_type_size(&field.type_name);
        let mut placed = false;
        for slot in &mut slots {
            let current_size: usize =
                slot.iter().map(|f| get_vyper_type_size(&f.type_name)).sum();
            if current_size + size <= 32 {
                slot.push(field.clone());
                placed = true;
                break;
            }
        }
        if !placed {
            slots.push(vec![field.clone()]);
        }
    }

    let mut optimal: Vec<crate::vyper::parser::VyperStructField> = Vec::new();
    for slot in &slots {
        optimal.extend(slot.clone());
    }

    optimal.extend(non_packable);

    optimal
}

/// Generate a suggestion string for reordering struct fields
pub fn generate_suggestion(
    struct_name: &str,
    original_fields: &[crate::vyper::parser::VyperStructField],
    reordered_fields: &[crate::vyper::parser::VyperStructField],
    saved_slots: usize,
) -> String {
    let mut suggestion = format!(
        "Reorder struct '{}' fields to save {} storage slot(s).\n",
        struct_name, saved_slots
    );
    suggestion.push_str("Current ordering:\n");
    for field in original_fields {
        suggestion.push_str(&format!("  {}: {}\n", field.name, field.type_name));
    }
    suggestion.push_str("Suggested ordering:\n");
    for field in reordered_fields {
        suggestion.push_str(&format!("  {}: {}\n", field.name, field.type_name));
    }
    suggestion
}

/// Rule for detecting unpacked storage slots in Vyper structs
pub struct StructStoragePackingRule;

impl VyperRule for StructStoragePackingRule {
    fn name(&self) -> &str {
        "vyper-struct-storage-packing"
    }

    fn description(&self) -> &str {
        "Detects struct definitions with unpacked storage slots where reordering fields could save gas."
    }

    fn check(&self, contract: &VyperContract) -> Vec<RuleViolation> {
        let mut violations = Vec::new();

        for struct_def in &contract.structs {
            if struct_def.fields.len() < 2 {
                continue;
            }

            let current_slots = calculate_storage_slots(&struct_def.fields);
            let reordered_fields = find_optimal_ordering(&struct_def.fields);
            let optimal_slots = calculate_storage_slots(&reordered_fields);

            if optimal_slots < current_slots {
                let saved_slots = current_slots - optimal_slots;
                let suggestion = generate_suggestion(
                    &struct_def.name,
                    &struct_def.fields,
                    &reordered_fields,
                    saved_slots,
                );

                violations.push(RuleViolation {
                    rule_name: self.name().to_string(),
                    description: format!(
                        "Struct '{}' has unpacked storage slots. Current: {} slots, Optimal: {} slots (saves {}).",
                        struct_def.name, current_slots, optimal_slots, saved_slots
                    ),
                    severity: ViolationSeverity::Warning,
                    line_number: struct_def.line_number,
                    column_number: 1,
                    variable_name: struct_def.name.clone(),
                    suggestion,
                });
            }
        }

        violations
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_vyper_type_size() {
        assert_eq!(get_vyper_type_size("uint8"), 1);
        assert_eq!(get_vyper_type_size("uint16"), 2);
        assert_eq!(get_vyper_type_size("uint256"), 32);
        assert_eq!(get_vyper_type_size("uint"), 32);
        assert_eq!(get_vyper_type_size("bool"), 1);
        assert_eq!(get_vyper_type_size("address"), 20);
        assert_eq!(get_vyper_type_size("bytes1"), 1);
        assert_eq!(get_vyper_type_size("bytes32"), 32);
    }

    #[test]
    fn test_is_vyper_packable_type() {
        assert!(is_vyper_packable_type("uint8"));
        assert!(is_vyper_packable_type("uint128"));
        assert!(is_vyper_packable_type("bool"));
        assert!(is_vyper_packable_type("address"));
        assert!(!is_vyper_packable_type("uint256"));
        assert!(!is_vyper_packable_type("bytes32"));
        assert!(!is_vyper_packable_type("string"));
        assert!(!is_vyper_packable_type("uint8[]"));
    }

    #[test]
    fn test_calculate_storage_slots() {
        let fields = vec![
            crate::vyper::parser::VyperStructField {
                name: "flag1".to_string(),
                type_name: "bool".to_string(),
                size_bytes: 1,
                line_number: 1,
            },
            crate::vyper::parser::VyperStructField {
                name: "flag2".to_string(),
                type_name: "bool".to_string(),
                size_bytes: 1,
                line_number: 2,
            },
        ];

        assert_eq!(calculate_storage_slots(&fields), 1);
    }

    #[test]
    fn test_find_optimal_ordering() {
        let fields = vec![
            crate::vyper::parser::VyperStructField {
                name: "flag1".to_string(),
                type_name: "bool".to_string(),
                size_bytes: 1,
                line_number: 1,
            },
            crate::vyper::parser::VyperStructField {
                name: "value".to_string(),
                type_name: "uint256".to_string(),
                size_bytes: 32,
                line_number: 2,
            },
            crate::vyper::parser::VyperStructField {
                name: "flag2".to_string(),
                type_name: "bool".to_string(),
                size_bytes: 1,
                line_number: 3,
            },
        ];

        let optimal = find_optimal_ordering(&fields);
        let flag_positions: Vec<usize> = optimal
            .iter()
            .enumerate()
            .filter(|(_, f)| f.name.starts_with("flag"))
            .map(|(i, _)| i)
            .collect();

        assert_eq!(flag_positions, vec![0, 1]);
    }

    #[test]
    fn test_detect_unpacked_struct() {
        let source = r#"
struct User:
    is_active: bool
    balance: uint256
    nonce: uint8
"#;
        let contract = VyperContract::parse(source).unwrap();
        let rule = StructStoragePackingRule;
        let violations = rule.check(&contract);

        assert_eq!(violations.len(), 1);
        assert!(violations[0].description.contains("User"));
    }

    #[test]
    fn test_no_violation_for_optimal_struct() {
        let source = r#"
struct User:
    nonce: uint8
    is_active: bool
    balance: uint256
"#;
        let contract = VyperContract::parse(source).unwrap();
        let rule = StructStoragePackingRule;
        let violations = rule.check(&contract);

        assert_eq!(violations.len(), 0);
    }

    #[test]
    fn test_multiple_structs() {
        let source = r#"
struct User:
    active: bool
    balance: uint256

struct Config:
    enabled: bool
    value: uint256
"#;
        let contract = VyperContract::parse(source).unwrap();
        let rule = StructStoragePackingRule;
        let violations = rule.check(&contract);

        assert_eq!(violations.len(), 2);
    }

    #[test]
    fn test_suggestion_output() {
        let source = r#"
struct User:
    is_active: bool
    balance: uint256
    nonce: uint8
"#;
        let contract = VyperContract::parse(source).unwrap();
        let rule = StructStoragePackingRule;
        let violations = rule.check(&contract);

        assert_eq!(violations.len(), 1);
        assert!(violations[0].suggestion.contains("Suggested ordering"));
        assert!(violations[0].suggestion.contains("is_active"));
        assert!(violations[0].suggestion.contains("nonce"));
    }
}
