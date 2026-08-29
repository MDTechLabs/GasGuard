use std::fs;
use std::path::Path;

use crate::transformers::storage_packer::transform_storage_layout;

/// Runs the G015 storage-slot re-ordering transform on a Solidity contract
/// file, writing the transformed source back to disk (or to `output_path`
/// if provided) and printing a summary of the savings achieved.
pub fn run_reorder_storage(contract_path: &str, output_path: Option<&str>) -> Result<(), String> {
    let path = Path::new(contract_path);
    if !path.exists() {
        return Err(format!("Contract file not found: {}", contract_path));
    }

    let source = fs::read_to_string(path).map_err(|e| format!("Failed to read file: {}", e))?;

    let result = transform_storage_layout(&source)?;

    println!("\n  GasGuard Reorder Storage (Rule G015)");
    println!("  ──────────────────────────────────────────────────────────");
    println!("  Contract: {}", path.display());

    if result.already_optimal {
        println!("  ✓ Storage layout is already optimal. No changes made.");
        return Ok(());
    }

    println!(
        "  ✓ Reordered {} variable(s), saving {} storage slot(s).",
        result.variables_reordered, result.savings_slots
    );

    let destination = output_path.unwrap_or(contract_path);
    fs::write(destination, &result.transformed_source)
        .map_err(|e| format!("Failed to write output: {}", e))?;

    println!("  Written to: {}", destination);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_reorder_storage_file_not_found() {
        let result = run_reorder_storage("/nonexistent/Contract.sol", None);
        assert!(result.is_err());
    }
}
