/// State Variable Packing Detection Rule
///
/// This rule detects opportunities to optimize storage layout by packing state variables efficiently.
/// In Solidity, storage is organized into 32-byte slots. Multiple smaller types can be packed
/// into a single slot to save gas costs.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VariableInfo {
    pub name: String,
    pub type_name: String,
    pub size_bytes: usize,
    pub line_number: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PackingOpportunity {
    pub variables: Vec<VariableInfo>,
    pub total_bytes: usize,
    pub wasted_bytes: usize,
    pub packed_slots: usize,
    pub suggestion: String,
}

/// Calculate the size of a Solidity type in bytes
pub fn get_type_size(type_name: &str) -> usize {
    let base_type = type_name.trim().to_lowercase();

    if base_type.starts_with("uint") {
        if let Some(bits_str) = base_type.strip_prefix("uint") {
            if bits_str.is_empty() {
                return 32; // uint = uint256
            }
            if let Ok(bits) = bits_str.parse::<usize>() {
                return bits / 8;
            }
        }
    }

    if base_type.starts_with("int") {
        if let Some(bits_str) = base_type.strip_prefix("int") {
            if bits_str.is_empty() {
                return 32; // int = int256
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
        _ => 32, // Default to 32 bytes for complex types
    }
}

/// Check if a type can be packed with other types
pub fn is_packable_type(type_name: &str) -> bool {
    let base_type = type_name.trim().to_lowercase();

    // Exclude dynamic types and mappings
    if base_type.contains("[]") || base_type.contains("mapping") || base_type.contains("string") {
        return false;
    }

    // Check for sized types that can be packed
    if base_type.starts_with("uint")
        || base_type.starts_with("int")
        || base_type == "bool"
        || base_type == "address"
        || base_type.starts_with("bytes")
    {
        let size = get_type_size(type_name);
        return size < 32;
    }

    false
}

/// Detect packing opportunities in a list of state variables
pub fn detect_packing_opportunities(variables: Vec<VariableInfo>) -> Vec<PackingOpportunity> {
    let mut opportunities = Vec::new();
    let mut packable_vars: Vec<VariableInfo> = variables
        .into_iter()
        .filter(|v| is_packable_type(&v.type_name))
        .collect();

    while !packable_vars.is_empty() {
        let mut group = vec![packable_vars.remove(0)];
        let mut total_bytes = group[0].size_bytes;

        // Try to pack more variables into this slot (32 bytes)
        while total_bytes < 32 && !packable_vars.is_empty() {
            let next_size = packable_vars[0].size_bytes;
            if total_bytes + next_size <= 32 {
                group.push(packable_vars.remove(0));
                total_bytes += next_size;
            } else {
                break;
            }
        }

        // Only report if there are packing opportunities (more than 1 var or significant waste)
        if group.len() > 1 {
            let wasted_bytes = 32 - total_bytes;
            let packed_slots = (total_bytes + 31) / 32;

            let mut suggestion = String::from("Pack these variables into a struct: ");
            for (i, var) in group.iter().enumerate() {
                if i > 0 {
                    suggestion.push_str(", ");
                }
                suggestion.push_str(&var.name);
            }
            if wasted_bytes > 0 {
                suggestion.push_str(&format!(" (saves {} byte(s) per slot)", wasted_bytes));
            }

            opportunities.push(PackingOpportunity {
                variables: group,
                total_bytes,
                wasted_bytes,
                packed_slots,
                suggestion,
            });
        }
    }

    opportunities
}

/// Find consecutive packable variables that can be grouped
pub fn find_consecutive_packable_groups(variables: &[VariableInfo]) -> Vec<Vec<VariableInfo>> {
    let mut groups = Vec::new();
    let mut current_group = Vec::new();
    let mut current_size = 0usize;

    for var in variables {
        if !is_packable_type(&var.type_name) {
            if !current_group.is_empty() {
                groups.push(current_group.clone());
                current_group.clear();
                current_size = 0;
            }
        } else if current_size + var.size_bytes <= 32 {
            current_group.push(var.clone());
            current_size += var.size_bytes;
        } else {
            if !current_group.is_empty() {
                groups.push(current_group.clone());
            }
            current_group = vec![var.clone()];
            current_size = var.size_bytes;
        }
    }

    if !current_group.is_empty() {
        groups.push(current_group);
    }

    groups
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_type_size() {
        assert_eq!(get_type_size("uint8"), 1);
        assert_eq!(get_type_size("uint16"), 2);
        assert_eq!(get_type_size("uint256"), 32);
        assert_eq!(get_type_size("bool"), 1);
        assert_eq!(get_type_size("address"), 20);
        assert_eq!(get_type_size("bytes32"), 32);
    }

    #[test]
    fn test_is_packable_type() {
        assert!(is_packable_type("uint8"));
        assert!(is_packable_type("uint16"));
        assert!(!is_packable_type("uint256"));
        assert!(is_packable_type("bool"));
        assert!(is_packable_type("address"));
        assert!(!is_packable_type("string"));
        assert!(!is_packable_type("uint256[]"));
    }

    #[test]
    fn test_detect_packing_opportunities() {
        let vars = vec![
            VariableInfo {
                name: "a".to_string(),
                type_name: "uint8".to_string(),
                size_bytes: 1,
                line_number: 1,
            },
            VariableInfo {
                name: "b".to_string(),
                type_name: "uint8".to_string(),
                size_bytes: 1,
                line_number: 2,
            },
        ];

        let opportunities = detect_packing_opportunities(vars);
        assert_eq!(opportunities.len(), 1);
        assert_eq!(opportunities[0].variables.len(), 2);
    }
}
