//! Rule G020: Automated refactoring transformer for EIP-1153 transient
//! storage locks.
//!
//! Detects the standard reentrancy-guard idiom — a `bool` state variable
//! that exists purely to flag "currently inside a protected call", checked
//! and cleared within a single transaction and never meaningfully read
//! across transactions — and rewrites it to use EIP-1153 transient storage
//! (`tstore`/`tload`) instead of a persistent storage slot.
//!
//! Detected shape (the idiom used by OpenZeppelin's `ReentrancyGuard` and
//! most hand-rolled equivalents):
//!
//! ```solidity
//! bool private _locked;
//!
//! modifier nonReentrant() {
//!     require(!_locked, "ReentrancyGuard: reentrant call");
//!     _locked = true;
//!     _;
//!     _locked = false;
//! }
//! ```
//!
//! becomes:
//!
//! ```solidity
//! modifier nonReentrant() {
//!     bool _lockedTransient;
//!     assembly { _lockedTransient := tload(0) }
//!     require(!_lockedTransient, "ReentrancyGuard: reentrant call");
//!     assembly { tstore(0, 1) }
//!     _;
//!     assembly { tstore(0, 0) }
//! }
//! ```
//!
//! Only variables used *exclusively* in this exact check/set/clear pattern
//! are converted — a variable read or written anywhere else in the
//! contract (a getter, an event, another modifier) is left untouched,
//! since a variable read outside a single-call guard is evidence it isn't
//! purely an intra-transaction lock.
//!
//! Transient storage's defining property — its value resets to zero at the
//! end of every transaction, never persisting across transactions — is
//! exactly what a reentrancy-guard flag needs and nothing more, so
//! converting it away from persistent storage costs nothing in the cases
//! this transform targets while saving a cold/warm `SSTORE` per guarded
//! call.

/// A candidate transient-lock variable found in the source.
#[derive(Debug, Clone)]
struct LockCandidate {
    name: String,
    declaration_line_idx: usize,
    modifier_start_idx: usize,
    require_line_idx: usize,
    require_line_text: String,
    set_true_line_idx: usize,
    yield_line_idx: usize,
    set_false_line_idx: usize,
}

/// Result of running the G020 transient-lock transform on a contract source.
#[derive(Debug, Clone)]
pub struct TransientLockResult {
    /// The rewritten Solidity source with detected locks converted to
    /// transient storage.
    pub transformed_source: String,
    /// Number of lock variables converted.
    pub locks_transformed: usize,
    /// True if no convertible lock pattern was found.
    pub already_optimal: bool,
}

/// Runs the G020 transform on `source`, converting every detected
/// exclusively-intra-transaction `bool` lock variable to EIP-1153
/// transient storage.
pub fn transform_transient_locks(source: &str) -> Result<TransientLockResult, String> {
    let lines: Vec<&str> = source.lines().collect();
    let candidates = find_lock_candidates(&lines);

    if candidates.is_empty() {
        return Ok(TransientLockResult {
            transformed_source: source.to_string(),
            locks_transformed: 0,
            already_optimal: true,
        });
    }

    // Each converted lock gets its own transient slot, numbered in the
    // order it was found. Transient storage is a separate address space
    // from persistent storage, so small sequential literals (0, 1, 2, ...)
    // are safe: they cannot collide with any persistent storage slot, and
    // distinct locks in the same contract get distinct slots.
    let mut output: Vec<String> = lines.iter().map(|s| s.to_string()).collect();

    // Apply transforms from the bottom of the file upward so that earlier
    // line indices remain valid as later lines are rewritten in place
    // (this transform only rewrites/removes lines, never inserts new
    // lines except within a rewritten line itself, so indices are stable
    // either direction — bottom-up is just the conservative choice).
    for (slot, candidate) in candidates.iter().enumerate().rev() {
        apply_transform(&mut output, candidate, slot as u64);
    }

    let mut transformed_source = output.join("\n");
    if source.ends_with('\n') {
        transformed_source.push('\n');
    }

    Ok(TransientLockResult {
        transformed_source,
        locks_transformed: candidates.len(),
        already_optimal: false,
    })
}

fn apply_transform(lines: &mut Vec<String>, candidate: &LockCandidate, slot: u64) {
    let indent = leading_whitespace(&lines[candidate.require_line_idx]);
    let body_indent = format!("{indent}    ");

    lines[candidate.set_false_line_idx] =
        format!("{indent}assembly {{ tstore({slot}, 0) }}");
    lines[candidate.yield_line_idx] = format!("{indent}_;");
    lines[candidate.set_true_line_idx] =
        format!("{indent}assembly {{ tstore({slot}, 1) }}");

    let local_name = format!("{}Transient", candidate.name);
    let require_text = candidate
        .require_line_text
        .replace(&candidate.name, &local_name);
    lines[candidate.require_line_idx] = format!(
        "{indent}bool {local_name};\n{indent}assembly {{ {local_name} := tload({slot}) }}\n{require_text}"
    );
    let _ = body_indent;

    // Remove the now-unused state variable declaration (and any single
    // leading blank line directly above it, to avoid leaving a stray gap).
    lines[candidate.declaration_line_idx] = String::new();

    let _ = candidate.modifier_start_idx;
}

fn leading_whitespace(line: &str) -> String {
    line.chars().take_while(|c| c.is_whitespace()).collect()
}

/// Scans `lines` for `bool` state variable declarations that are used
/// exclusively by a single modifier following the check/set/yield/clear
/// idiom described in the module docs.
fn find_lock_candidates(lines: &[&str]) -> Vec<LockCandidate> {
    let mut candidates = Vec::new();

    let declarations = find_bool_declarations(lines);
    for (name, decl_idx) in declarations {
        if let Some(candidate) = find_guard_modifier(lines, &name, decl_idx) {
            // Exclusivity check: the variable name must appear nowhere
            // else in the source outside the declaration and the four
            // guard-modifier lines already matched. This is what
            // distinguishes a pure intra-transaction lock from a flag
            // that's also read elsewhere (a getter, another modifier,
            // an event) — such a variable must keep its persistent value
            // across transactions and is not a safe conversion target.
            // Exactly 4 occurrences are expected when the variable is a
            // pure intra-transaction lock: the declaration, the
            // `require(!NAME, ...)` check, `NAME = true;`, and
            // `NAME = false;` (the yield line `_;` contains no occurrence
            // of the name at all). Any other count means the variable is
            // read or written somewhere outside this exact pattern.
            let occurrences = count_word_occurrences(lines, &name);
            if occurrences == 4 {
                candidates.push(candidate);
            }
        }
    }

    candidates
}

fn find_bool_declarations(lines: &[&str]) -> Vec<(String, usize)> {
    let mut out = Vec::new();
    for (idx, raw) in lines.iter().enumerate() {
        let trimmed = raw.trim();
        let code_part = match trimmed.find("//") {
            Some(pos) => trimmed[..pos].trim(),
            None => trimmed,
        };
        if !code_part.starts_with("bool ") || !code_part.ends_with(';') {
            continue;
        }
        let body = &code_part[..code_part.len() - 1];
        // Accept an optional `= false` initializer (semantically identical
        // to the implicit default, so still a safe conversion target) but
        // reject any other initializer.
        let (decl_part, init_part) = match body.find('=') {
            Some(pos) => (body[..pos].trim(), Some(body[pos + 1..].trim())),
            None => (body, None),
        };
        if let Some(init) = init_part {
            if init != "false" {
                continue;
            }
        }
        let tokens: Vec<&str> = decl_part.split_whitespace().collect();
        // `bool`, optional visibility keyword(s), name.
        if tokens.len() < 2 || tokens.len() > 3 {
            continue;
        }
        let name = tokens[tokens.len() - 1];
        if name.is_empty() || !name.chars().next().unwrap().is_alphabetic() && name.chars().next() != Some('_') {
            continue;
        }
        out.push((name.to_string(), idx));
    }
    out
}

/// Looks for a modifier body matching exactly:
///   require(!NAME, "...");   (or `require(!NAME);`)
///   NAME = true;
///   _;
///   NAME = false;
/// as four consecutive non-empty, non-comment lines.
fn find_guard_modifier(lines: &[&str], name: &str, decl_idx: usize) -> Option<LockCandidate> {
    let require_prefix_bang = format!("require(!{name},");
    let require_prefix_bang_noargs = format!("require(!{name})");
    let set_true = format!("{name} = true;");
    let set_false = format!("{name} = false;");

    let mut i = 0usize;
    while i + 3 < lines.len() {
        let l0 = lines[i].trim();
        if l0.starts_with(&require_prefix_bang) || l0 == require_prefix_bang_noargs {
            let l1 = lines[i + 1].trim();
            let l2 = lines[i + 2].trim();
            let l3 = lines[i + 3].trim();
            if l1 == set_true && l2 == "_;" && l3 == set_false {
                return Some(LockCandidate {
                    name: name.to_string(),
                    declaration_line_idx: decl_idx,
                    modifier_start_idx: i,
                    require_line_idx: i,
                    require_line_text: lines[i].to_string(),
                    set_true_line_idx: i + 1,
                    yield_line_idx: i + 2,
                    set_false_line_idx: i + 3,
                });
            }
        }
        i += 1;
    }
    None
}

/// Counts whole-word occurrences of `name` across all lines (used as a
/// coarse exclusivity check — a variable used anywhere beyond the matched
/// guard pattern is left untouched).
fn count_word_occurrences(lines: &[&str], name: &str) -> usize {
    let mut count = 0;
    for line in lines {
        let trimmed = line.trim_start();
        if trimmed.starts_with("//") || trimmed.starts_with("/*") || trimmed.starts_with('*') {
            continue;
        }
        // Strip a trailing inline `//` comment before counting, same
        // convention `storage_packer` uses when parsing declarations.
        let code_part = match line.find("//") {
            Some(pos) => &line[..pos],
            None => line,
        };
        let bytes = code_part.as_bytes();
        let name_bytes = name.as_bytes();
        let mut start = 0usize;
        while let Some(pos) = find_from(bytes, name_bytes, start) {
            let before_ok = pos == 0 || !is_word_byte(bytes[pos - 1]);
            let after_idx = pos + name_bytes.len();
            let after_ok = after_idx >= bytes.len() || !is_word_byte(bytes[after_idx]);
            if before_ok && after_ok {
                count += 1;
            }
            start = pos + 1;
        }
    }
    count
}

fn is_word_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

fn find_from(haystack: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    if needle.is_empty() || from >= haystack.len() {
        return None;
    }
    haystack[from..]
        .windows(needle.len())
        .position(|w| w == needle)
        .map(|p| p + from)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = r#"// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract VaultWithGuard {
    bool private _locked;

    modifier nonReentrant() {
        require(!_locked, "ReentrancyGuard: reentrant call");
        _locked = true;
        _;
        _locked = false;
    }

    function withdraw() external nonReentrant {
        // ...
    }
}
"#;

    #[test]
    fn transform_converts_the_standard_reentrancy_guard_idiom() {
        let result = transform_transient_locks(FIXTURE).unwrap();
        assert!(!result.already_optimal);
        assert_eq!(result.locks_transformed, 1);

        assert!(!result.transformed_source.contains("bool private _locked;"));
        assert!(result.transformed_source.contains("tstore(0, 1)"));
        assert!(result.transformed_source.contains("tstore(0, 0)"));
        assert!(result.transformed_source.contains("tload(0)"));
        assert!(result
            .transformed_source
            .contains("require(!_lockedTransient, \"ReentrancyGuard: reentrant call\");"));
    }

    #[test]
    fn transform_preserves_the_original_require_message() {
        let result = transform_transient_locks(FIXTURE).unwrap();
        assert!(result
            .transformed_source
            .contains("ReentrancyGuard: reentrant call"));
    }

    #[test]
    fn transform_preserves_unrelated_functions() {
        let result = transform_transient_locks(FIXTURE).unwrap();
        assert!(result.transformed_source.contains("function withdraw() external nonReentrant {"));
        assert!(result.transformed_source.contains("pragma solidity ^0.8.24;"));
    }

    #[test]
    fn transform_is_noop_when_no_guard_pattern_present() {
        let source = "contract Plain {\n    uint256 public balance;\n\n    function noop() external {}\n}\n";
        let result = transform_transient_locks(source).unwrap();
        assert!(result.already_optimal);
        assert_eq!(result.locks_transformed, 0);
        assert_eq!(result.transformed_source, source);
    }

    #[test]
    fn transform_skips_a_lock_variable_also_read_elsewhere() {
        // `_locked` is read in an extra getter below the guard modifier,
        // so it is NOT a pure intra-transaction lock and must be left as
        // persistent storage.
        let source = r#"contract NotAPureLock {
    bool private _locked;

    modifier nonReentrant() {
        require(!_locked, "ReentrancyGuard: reentrant call");
        _locked = true;
        _;
        _locked = false;
    }

    function isLocked() external view returns (bool) {
        return _locked;
    }
}
"#;
        let result = transform_transient_locks(source).unwrap();
        assert!(result.already_optimal);
        assert_eq!(result.locks_transformed, 0);
        assert_eq!(result.transformed_source, source);
    }

    #[test]
    fn transform_assigns_distinct_slots_to_multiple_locks() {
        let source = r#"contract TwoGuards {
    bool private _lockedA;
    bool private _lockedB;

    modifier nonReentrantA() {
        require(!_lockedA, "locked A");
        _lockedA = true;
        _;
        _lockedA = false;
    }

    modifier nonReentrantB() {
        require(!_lockedB, "locked B");
        _lockedB = true;
        _;
        _lockedB = false;
    }
}
"#;
        let result = transform_transient_locks(source).unwrap();
        assert_eq!(result.locks_transformed, 2);
        assert!(result.transformed_source.contains("tload(0)"));
        assert!(result.transformed_source.contains("tload(1)"));
        assert!(result.transformed_source.contains("tstore(0, 1)"));
        assert!(result.transformed_source.contains("tstore(1, 1)"));
    }

    #[test]
    fn transform_handles_a_lock_variable_with_explicit_false_initializer() {
        let source = r#"contract ExplicitInit {
    bool private _locked = false;

    modifier nonReentrant() {
        require(!_locked, "reentrant");
        _locked = true;
        _;
        _locked = false;
    }
}
"#;
        let result = transform_transient_locks(source).unwrap();
        assert_eq!(result.locks_transformed, 1);
        assert!(!result.transformed_source.contains("_locked = false;\n\n    modifier"));
    }
}
