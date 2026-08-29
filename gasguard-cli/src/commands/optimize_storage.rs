use std::fs;
use std::path::Path;

use crate::storage_model::{
    classify_variable, compute_optimal_packing, format_slot_visual, StateVariable,
};

/// Runs the optimize-storage command on a Solidity contract file.
///
/// Parses the contract, extracts state variables, computes optimal storage
/// packing, and prints a before/after slot visual map to the terminal.
pub fn run_optimize_storage(contract_path: &str) -> Result<(), String> {
    let path = Path::new(contract_path);
    if !path.exists() {
        return Err(format!("Contract file not found: {}", contract_path));
    }

    let source = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let variables = parse_state_variables(&source);

    if variables.is_empty() {
        println!("No state variables found in {}.", contract_path);
        return Ok(());
    }

    println!("\n  GasGuard Optimize Storage");
    println!("  ──────────────────────────────────────────────────────────");
    println!("  Contract: {}", path.display());
    println!("  State variables found: {}", variables.len());

    let result = compute_optimal_packing(&variables);

    println!("\n  BEFORE (declaration order):");
    println!("  ──────────────────────────────────────────────────────────");
    for (i, var) in variables.iter().enumerate() {
        println!(
            "  Slot {:>3}  {} ({})  {} bytes",
            i,
            var.name,
            var.type_name,
            var.size.bytes
        );
    }

    println!("{}", format_slot_visual(&result));

    if result.savings_slots > 0 {
        println!("  ✓ Optimization found: {} slot(s) saved ({} bytes)", result.savings_slots, result.savings_bytes);
    } else {
        println!("  ✓ Storage layout is already optimal.");
    }

    Ok(())
}

/// Parses state variable declarations from Solidity source text.
///
/// Extracts lines matching `<type> <name>;` patterns inside contract bodies.
/// This is a lightweight text-based parser suitable for the CLI tool's
/// scope; full AST-based parsing is a follow-up.
fn parse_state_variables(source: &str) -> Vec<StateVariable> {
    let mut variables = Vec::new();
    let mut in_contract = false;
    let mut brace_depth = 0;

    for (line_num, line) in source.lines().enumerate() {
        let trimmed = line.trim();

        if trimmed.starts_with("contract ") || trimmed.starts_with("library ") {
            in_contract = true;
        }

        if in_contract {
            for ch in trimmed.chars() {
                match ch {
                    '{' => brace_depth += 1,
                    '}' => brace_depth -= 1,
                    _ => {}
                }
            }

            if brace_depth == 0 && in_contract {
                in_contract = false;
                continue;
            }

            if brace_depth >= 1 {
                if let Some(var) = try_parse_variable(trimmed, line_num + 1) {
                    variables.push(var);
                }
            }
        }
    }

    variables
}

/// Attempts to parse a single state variable declaration line.
///
/// Matches patterns like:
/// - `uint256 public balance;`
/// - `mapping(address => uint256) public balances;`
/// - `bool internal isActive;`
fn try_parse_variable(line: &str, line_num: usize) -> Option<StateVariable> {
    let line = line.trim();

    if line.is_empty() || line.starts_with("//") || line.starts_with("/*") || line.starts_with('*') {
        return None;
    }

    if !line.ends_with(';') {
        return None;
    }

    let line = &line[..line.len() - 1];
    let line = line.trim();

    let last_semi = line.rfind(';').unwrap_or(line.len());
    let line = &line[last_semi..].trim();

    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 2 {
        return None;
    }

    let type_name = parts[0];
    let name = parts[parts.len() - 1];

    if name.is_empty() || type_name.is_empty() {
        return None;
    }

    if ["function", "modifier", "event", "struct", "enum", "using", "import", "abstract", "is", "returns", "external", "internal", "public", "private", "view", "pure", "payable", "virtual", "override", "returns"].contains(&type_name) {
        return None;
    }

    Some(classify_variable(name, type_name, line_num))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_state_variables_from_source() {
        let source = r#"
            contract TestContract {
                uint256 public totalSupply;
                mapping(address => uint256) public balances;
                bool internal isActive;
                uint8 public flags;
            }
        "#;

        let vars = parse_state_variables(source);
        assert_eq!(vars.len(), 4);
        assert_eq!(vars[0].name, "totalSupply");
        assert_eq!(vars[0].type_name, "uint256");
        assert_eq!(vars[1].name, "balances");
        assert_eq!(vars[1].type_name, "mapping(address => uint256)");
        assert_eq!(vars[2].name, "isActive");
        assert_eq!(vars[2].type_name, "bool");
        assert_eq!(vars[3].name, "flags");
        assert_eq!(vars[3].type_name, "uint8");
    }

    #[test]
    fn parse_empty_contract() {
        let source = r#"
            contract EmptyContract {
            }
        "#;

        let vars = parse_state_variables(source);
        assert!(vars.is_empty());
    }

    #[test]
    fn parse_ignores_functions() {
        let source = r#"
            contract MyContract {
                uint256 public value;
                function getValue() public view returns (uint256) {
                    return value;
                }
            }
        "#;

        let vars = parse_state_variables(source);
        assert_eq!(vars.len(), 1);
        assert_eq!(vars[0].name, "value");
    }

    #[test]
    fn run_optimize_storage_file_not_found() {
        let result = run_optimize_storage("/nonexistent/Contract.sol");
        assert!(result.is_err());
    }
}