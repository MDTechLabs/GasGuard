//! Rule G015: Automated AST storage-slot re-ordering transformer.
//!
//! Detects unpacked state variable declarations in a Solidity contract and
//! rewrites the source so that sub-32-byte variables are grouped together
//! sequentially, minimizing the number of 256-bit storage slots used. This
//! module reuses the packing algorithm already implemented in
//! `storage_model` (see `commands::optimize_storage` for the read-only,
//! visualization-only counterpart) and adds the source-rewriting step on
//! top of it.

use crate::storage_model::{classify_variable, compute_optimal_packing, StateVariable};

/// A single state variable declaration extracted from the source, keeping
/// enough of the original text to reproduce it verbatim (including any
/// trailing inline comment) when re-emitted in a new position.
#[derive(Debug, Clone)]
struct DeclarationBlock {
    /// Any full-line comments immediately preceding the declaration line,
    /// kept attached so they move together with the variable.
    leading_comments: Vec<String>,
    /// The exact original declaration line (including indentation, the
    /// trailing `;`, and any inline trailing comment).
    line_text: String,
    /// Classified metadata used to feed `compute_optimal_packing`.
    variable: StateVariable,
    /// Index into the original list of contract-body lines where this
    /// declaration (including leading comments) started.
    start_line_idx: usize,
    /// Index (exclusive) one past the declaration line itself.
    end_line_idx: usize,
}

/// Result of running the storage-packing transform on a contract source.
#[derive(Debug, Clone)]
pub struct TransformResult {
    /// The rewritten Solidity source with state variables reordered.
    pub transformed_source: String,
    /// Number of storage slots saved compared to declaration order.
    pub savings_slots: usize,
    /// Number of variables that were reordered.
    pub variables_reordered: usize,
    /// True if no reordering was necessary (layout was already optimal).
    pub already_optimal: bool,
}

/// Runs the G015 storage-packing transform on `source`, returning the
/// rewritten contract text and a summary of the savings achieved.
///
/// Only the *first* top-level `contract`/`library` body is transformed;
/// interfaces, structs, functions, events, and modifiers are left untouched
/// both in content and in their relative position. Only the contiguous run
/// of state-variable declaration lines is reordered.
pub fn transform_storage_layout(source: &str) -> Result<TransformResult, String> {
    let lines: Vec<&str> = source.lines().collect();
    let blocks = extract_declaration_blocks(&lines);

    if blocks.is_empty() {
        return Ok(TransformResult {
            transformed_source: source.to_string(),
            savings_slots: 0,
            variables_reordered: 0,
            already_optimal: true,
        });
    }

    let variables: Vec<StateVariable> = blocks.iter().map(|b| b.variable.clone()).collect();
    let packing = compute_optimal_packing(&variables);

    // Build the new declaration order: walk packing.slots in order, and
    // within each slot, preserve the relative original order of the
    // variables that were placed into it (stable grouping, not just size
    // sort) so the diff reads as "grouped", not "shuffled".
    let mut ordered_names: Vec<String> = Vec::with_capacity(blocks.len());
    for slot in &packing.slots {
        let mut in_slot: Vec<&StateVariable> = slot.variables.iter().collect();
        in_slot.sort_by_key(|v| v.declared_line);
        for v in in_slot {
            ordered_names.push(v.name.clone());
        }
    }

    let savings_slots = packing.savings_slots;
    if savings_slots == 0 {
        return Ok(TransformResult {
            transformed_source: source.to_string(),
            savings_slots: 0,
            variables_reordered: 0,
            already_optimal: true,
        });
    }

    // Map variable name -> its declaration block for quick lookup while
    // emitting in the new order.
    let mut by_name: std::collections::HashMap<String, &DeclarationBlock> =
        std::collections::HashMap::new();
    for b in &blocks {
        by_name.insert(b.variable.name.clone(), b);
    }

    let first_block_start = blocks.first().unwrap().start_line_idx;
    let last_block_end = blocks.last().unwrap().end_line_idx;

    let mut variables_reordered = 0usize;
    for (original, new_name) in blocks.iter().zip(ordered_names.iter()) {
        if &original.variable.name != new_name {
            variables_reordered += 1;
        }
    }

    let mut output_lines: Vec<String> = Vec::new();
    output_lines.extend(lines[..first_block_start].iter().map(|s| s.to_string()));

    for name in &ordered_names {
        if let Some(block) = by_name.get(name) {
            for comment in &block.leading_comments {
                output_lines.push(comment.clone());
            }
            output_lines.push(block.line_text.clone());
        }
    }

    output_lines.extend(lines[last_block_end..].iter().map(|s| s.to_string()));

    let mut transformed_source = output_lines.join("\n");
    if source.ends_with('\n') {
        transformed_source.push('\n');
    }

    Ok(TransformResult {
        transformed_source,
        savings_slots,
        variables_reordered,
        already_optimal: false,
    })
}

/// Extracts the contiguous run(s) of top-level state variable declarations
/// from a contract/library body, in source order, along with any leading
/// full-line comments attached to each.
fn extract_declaration_blocks(lines: &[&str]) -> Vec<DeclarationBlock> {
    let mut blocks = Vec::new();
    let mut in_contract = false;
    let mut brace_depth = 0i32;
    let mut pending_comments: Vec<String> = Vec::new();
    let mut pending_start: Option<usize> = None;

    for (idx, raw_line) in lines.iter().enumerate() {
        let trimmed = raw_line.trim();

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

            if brace_depth == 0 {
                in_contract = false;
                pending_comments.clear();
                pending_start = None;
                continue;
            }

            if brace_depth >= 1 {
                if trimmed.is_empty() {
                    pending_comments.clear();
                    pending_start = None;
                    continue;
                }

                if trimmed.starts_with("//") || trimmed.starts_with("/*") || trimmed.starts_with('*') {
                    if pending_start.is_none() {
                        pending_start = Some(idx);
                    }
                    pending_comments.push(raw_line.to_string());
                    continue;
                }

                if let Some(var) = try_parse_declaration(trimmed, idx) {
                    let start_line_idx = pending_start.unwrap_or(idx);
                    blocks.push(DeclarationBlock {
                        leading_comments: std::mem::take(&mut pending_comments),
                        line_text: raw_line.to_string(),
                        variable: var,
                        start_line_idx,
                        end_line_idx: idx + 1,
                    });
                    pending_start = None;
                    continue;
                }

                // Any other statement (function, event, etc.) breaks the
                // contiguous declaration run and discards pending comments
                // so they aren't wrongly attached to a later variable.
                pending_comments.clear();
                pending_start = None;
            }
        }
    }

    blocks
}

/// Parses a single trimmed line as a state variable declaration, mirroring
/// the lightweight text-based approach used by `commands::optimize_storage`.
fn try_parse_declaration(trimmed: &str, line_num: usize) -> Option<StateVariable> {
    if !trimmed.ends_with(';') {
        return None;
    }

    // Strip a trailing inline comment, if any, before tokenizing.
    let code_part = match trimmed.find("//") {
        Some(pos) => &trimmed[..pos],
        None => trimmed,
    };
    let code_part = code_part.trim();
    if !code_part.ends_with(';') {
        return None;
    }
    let code_part = &code_part[..code_part.len() - 1];

    let parts: Vec<&str> = code_part.split_whitespace().collect();
    if parts.len() < 2 {
        return None;
    }

    // Reject anything that isn't a plain state variable declaration:
    // functions, events, structs, using-for, imports, modifiers, and
    // declarations that carry an initializer (`= ...`) which this
    // conservative transform intentionally leaves untouched.
    const KEYWORDS: &[&str] = &[
        "function", "modifier", "event", "struct", "enum", "using", "import", "abstract", "is",
        "returns", "external", "internal", "public", "private", "view", "pure", "payable",
        "virtual", "override", "constructor", "error", "assembly",
    ];
    if KEYWORDS.contains(&parts[0]) {
        return None;
    }
    if code_part.contains('=') || code_part.contains('(') {
        return None;
    }

    let type_name = parts[0];
    let name = parts[parts.len() - 1];
    if name.is_empty() || type_name.is_empty() {
        return None;
    }

    Some(classify_variable(name, type_name, line_num))
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = r#"// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Unpacked {
    uint256 public balance;
    bool public isActive;
    address public owner;
    uint8 public tier;
    uint256 public totalSupply;

    function noop() external {}
}
"#;

    #[test]
    fn transform_groups_packable_variables_together() {
        let result = transform_storage_layout(FIXTURE).unwrap();
        assert!(!result.already_optimal);
        assert!(result.savings_slots > 0);

        // `isActive`, `owner`, and `tier` (1 + 20 + 1 = 22 bytes) fit in a
        // single slot together and should now be grouped as adjacent
        // declarations, rather than interleaved with the two full-slot
        // `uint256` variables.
        let is_active_pos = result.transformed_source.find("isActive").unwrap();
        let owner_pos = result.transformed_source.find("public owner").unwrap();
        let tier_pos = result.transformed_source.find("tier").unwrap();

        // All three packed-slot variables must appear in a contiguous run:
        // no full-slot variable declaration line falls between them.
        let mut positions = [is_active_pos, owner_pos, tier_pos];
        positions.sort_unstable();
        let span = &result.transformed_source[positions[0]..positions[2]];
        assert!(!span.contains("uint256"));
    }

    #[test]
    fn transform_preserves_non_variable_lines() {
        let result = transform_storage_layout(FIXTURE).unwrap();
        assert!(result.transformed_source.contains("pragma solidity ^0.8.20;"));
        assert!(result.transformed_source.contains("function noop() external {}"));
        assert!(result.transformed_source.contains("SPDX-License-Identifier: MIT"));
    }

    #[test]
    fn transform_is_noop_on_already_optimal_layout() {
        // Every variable here already consumes a full 32-byte slot on its
        // own (a `uint256`, a `mapping`, and a `bytes32`), so there is no
        // possible packing improvement and the transform must be a no-op.
        let source = r#"contract AlreadyPacked {
    uint256 public balance;
    mapping(address => uint256) public allowances;
    bytes32 public merkleRoot;
}
"#;
        let result = transform_storage_layout(source).unwrap();
        assert!(result.already_optimal);
        assert_eq!(result.transformed_source, source);
    }

    #[test]
    fn transform_groups_multiple_variables_that_already_pack_well() {
        // `bool` + `address` = 21 bytes fits in one slot; already grouped
        // adjacently, so packing finds the same 1-slot arrangement and
        // there's nothing to reorder relative to the other variables.
        let source = r#"contract SmallStruct {
    bool public flag;
    address public owner;
}
"#;
        let result = transform_storage_layout(source).unwrap();
        // 2 variables -> 1 slot is a real improvement over 2 naive slots,
        // so this *does* count as a savings, even though no reordering of
        // relative positions is visually needed.
        assert!(!result.already_optimal);
        assert_eq!(result.savings_slots, 1);
        assert_eq!(result.variables_reordered, 0);
    }

    #[test]
    fn transform_handles_contract_with_no_state_variables() {
        let source = "contract Empty {\n    function noop() external {}\n}\n";
        let result = transform_storage_layout(source).unwrap();
        assert!(result.already_optimal);
        assert_eq!(result.savings_slots, 0);
    }

    #[test]
    fn transform_preserves_leading_comments_with_their_variable() {
        let source = r#"contract Documented {
    /// @notice total balance
    uint256 public balance;
    /// @notice active flag
    bool public isActive;
    address public owner;
}
"#;
        let result = transform_storage_layout(source).unwrap();
        // The comment for isActive must stay directly above isActive.
        let comment_pos = result.transformed_source.find("@notice active flag").unwrap();
        let is_active_pos = result.transformed_source.find("bool public isActive").unwrap();
        assert!(comment_pos < is_active_pos);
        assert!(is_active_pos - comment_pos < 60);
    }

    #[test]
    fn transform_ignores_variables_with_initializers() {
        let source = r#"contract WithInit {
    uint256 public constant MAX = 100;
    bool public isActive;
    address public owner;
    uint256 public balance;
}
"#;
        // Should not panic or misclassify the `= 100` initializer line.
        let result = transform_storage_layout(source);
        assert!(result.is_ok());
    }
}
