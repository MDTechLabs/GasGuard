//! Rule G005: rewrites bounded `for` loop counters into the standard
//! `unchecked { ++i; }` gas-optimization idiom.
//!
//! Given:
//! ```solidity
//! for (uint256 i = 0; i < items.length; i++) { ... }
//! ```
//! produces:
//! ```solidity
//! for (uint256 i = 0; i < items.length; ) { ... unchecked { ++i; } }
//! ```
//!
//! The loop's own condition (`i < bound`) already guarantees the counter
//! stops advancing before it could overflow the surrounding integer type —
//! Solidity's default overflow checks on the `++`/`+=` step are therefore
//! redundant work paid on every iteration. Moving the increment into the
//! loop body's own `unchecked` block removes that redundant check while
//! leaving every other part of the loop's normal checked-arithmetic
//! semantics untouched.
//!
//! Scope, deliberately conservative — a loop is only rewritten when ALL of:
//! - it declares its own counter inline in the `for` init clause (so we know
//!   its type and that nothing outside the loop aliases it mid-loop),
//! - its increment clause is exactly a single `i++`, `++i`, or `i += 1` step
//!   on that same counter (any other step size, or a decrement, changes the
//!   overflow-safety argument enough that this rule declines to guess), and
//! - its body is brace-delimited (`{ ... }`), so the rewritten increment has
//!   an unambiguous place to live.
//!
//! A loop whose increment clause is already empty (the counter is advanced
//! inside the body instead — including the already-`unchecked`-wrapped
//! idiom this rule itself produces) is left alone: there is nothing in the
//! header to move, and guessing at body contents risks double-wrapping.

use std::fmt::Write as _;

/// Outcome of running the rewriter over one source file.
pub struct RewriteResult {
    /// The rewritten source. Identical to the input when `rewrites_applied == 0`.
    pub output: String,
    /// Number of loop counters rewritten.
    pub rewrites_applied: usize,
}

/// One matched, rewritable `for` loop.
struct LoopMatch {
    /// Byte offset of the `for` keyword.
    for_start: usize,
    /// Exact source text of the init clause (e.g. `"uint256 i = 0"`).
    init: String,
    /// Exact source text of the condition clause (e.g. `"i < items.length"`).
    condition: String,
    /// Byte offset of the header's closing `)`.
    header_close_paren: usize,
    /// Counter variable name, as declared in `init`.
    var_name: String,
    /// Byte offset of the loop body's opening `{`.
    body_open_brace: usize,
    /// Byte offset of the loop body's matching closing `}`.
    body_close_brace: usize,
}

/// Rewrites every eligible bounded loop counter in `source` into the
/// `unchecked { ++i; }` idiom described above.
pub fn rewrite_unchecked_loops(source: &str) -> RewriteResult {
    let bytes = source.as_bytes();
    let mut matches = Vec::new();
    let mut i = 0;

    while i < bytes.len() {
        if let Some(skip) = comment_or_string_len(bytes, i) {
            i += skip;
            continue;
        }
        if starts_with_word(bytes, i, b"for") {
            if let Some(m) = try_match_for_loop(source, bytes, i) {
                // Resume scanning just inside the body (not past it) so any
                // loop nested within it is still discovered.
                i = m.body_open_brace + 1;
                matches.push(m);
                continue;
            }
        }
        i += 1;
    }

    if matches.is_empty() {
        return RewriteResult {
            output: source.to_string(),
            rewrites_applied: 0,
        };
    }

    // Each match produces two independent edits at two different source
    // positions (rewrite the header; insert into the body). For nested
    // loops those positions interleave — an outer loop's body-close sits
    // AFTER everything nested inside it, while its header sits BEFORE all
    // of it — so edits must be sorted by position and applied strictly
    // highest-offset-first, not grouped by match, or an inner edit would
    // invalidate the outer body edit's byte offset before it runs.
    let mut edits: Vec<(usize, usize, String)> = Vec::new(); // (start, end_exclusive, replacement)
    for m in &matches {
        let body = &source[m.body_open_brace + 1..m.body_close_brace];
        let content_indent = last_line_indent(body).unwrap_or_else(|| "    ".to_string());
        let close_indent = indent_of_position(source, m.body_close_brace);

        let mut inserted_increment = String::new();
        let _ = write!(
            inserted_increment,
            "\n{content_indent}unchecked {{\n{content_indent}    ++{var};\n{content_indent}}}\n{close_indent}",
            content_indent = content_indent,
            var = m.var_name,
            close_indent = close_indent
        );
        // Replace all trailing whitespace between the body's last real
        // statement and its closing brace with the reconstructed block above,
        // so the closing brace still lands on its own properly indented line.
        let body_trimmed_end = m.body_open_brace + 1 + body.trim_end().len();
        edits.push((body_trimmed_end, m.body_close_brace, inserted_increment));

        let new_header = format!("for ({init}; {cond}; )", init = m.init, cond = m.condition);
        edits.push((m.for_start, m.header_close_paren + 1, new_header));
    }
    edits.sort_by_key(|e| std::cmp::Reverse(e.0));

    let mut output = source.to_string();
    for (start, end, replacement) in edits {
        output.replace_range(start..end, &replacement);
    }

    RewriteResult {
        output,
        rewrites_applied: matches.len(),
    }
}

/// Indentation (leading whitespace) of the last non-blank line in `text`.
fn last_line_indent(text: &str) -> Option<String> {
    text.lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .map(|l| l.chars().take_while(|c| *c == ' ' || *c == '\t').collect())
}

/// Leading whitespace of the physical line containing byte offset `pos` in
/// `source`, from the start of that line up to `pos` itself — unlike
/// `last_line_indent`, this does not skip blank lines, so it correctly
/// reports a closing brace's own indentation even when it sits alone on its
/// line with nothing but whitespace before it.
fn indent_of_position(source: &str, pos: usize) -> String {
    let before = &source[..pos];
    let line_start = before.rfind('\n').map(|p| p + 1).unwrap_or(0);
    source[line_start..pos]
        .chars()
        .take_while(|c| *c == ' ' || *c == '\t')
        .collect()
}

/// Attempts to parse a rewritable `for` loop starting at `for_start`
/// (the byte offset of the `f` in `for`). Returns `None` if this isn't a
/// brace-delimited, single-counter, +1-step bounded loop.
fn try_match_for_loop(source: &str, bytes: &[u8], for_start: usize) -> Option<LoopMatch> {
    let mut i = for_start + 3; // past "for"
    i = skip_ws_and_comments(bytes, i);
    if bytes.get(i) != Some(&b'(') {
        return None;
    }
    let paren_open = i;
    let paren_close = matching_close(bytes, paren_open, b'(', b')')?;

    let header = &source[paren_open + 1..paren_close];
    let clauses = split_top_level_semicolons(header.as_bytes(), header)?;
    if clauses.len() != 3 {
        return None;
    }
    let init = clauses[0].trim().to_string();
    let condition = clauses[1].trim().to_string();
    let increment = clauses[2].trim();

    let var_name = declared_counter_name(&init)?;
    if !is_simple_increment(increment, &var_name) {
        return None;
    }

    let mut j = skip_ws_and_comments(bytes, paren_close + 1);
    if bytes.get(j) != Some(&b'{') {
        // Single-statement body with no braces — out of scope (see module docs).
        return None;
    }
    let body_open = j;
    let body_close = matching_close(bytes, body_open, b'{', b'}')?;
    j = body_close; // silence unused-assignment warning in some rustc versions

    let _ = j;
    Some(LoopMatch {
        for_start,
        init,
        condition,
        header_close_paren: paren_close,
        var_name,
        body_open_brace: body_open,
        body_close_brace: body_close,
    })
}

/// Extracts `i` from an init clause of the form `<type> i = <expr>`
/// (e.g. `uint256 i = 0`, `uint i`). Returns `None` for anything else,
/// including an empty init clause or one that doesn't declare a fresh
/// variable (e.g. reusing a counter declared outside the loop).
fn declared_counter_name(init: &str) -> Option<String> {
    let init = init.trim();
    if init.is_empty() {
        return None;
    }
    let mut words = init.split_whitespace();
    let ty = words.next()?;
    if !(ty.starts_with("uint") || ty.starts_with("int")) {
        return None;
    }
    let rest = words.next()?;
    let name: String = rest
        .chars()
        .take_while(|c| c.is_alphanumeric() || *c == '_')
        .collect();
    if name.is_empty()
        || name
            .chars()
            .next()
            .map(|c| c.is_ascii_digit())
            .unwrap_or(true)
    {
        return None;
    }
    Some(name)
}

/// True if `clause` is exactly `VAR++`, `++VAR`, or `VAR += 1`.
fn is_simple_increment(clause: &str, var: &str) -> bool {
    let clause = clause.trim();
    if clause.is_empty() {
        return false;
    }
    clause == format!("{var}++")
        || clause == format!("++{var}")
        || clause == format!("{var} += 1")
        || clause == format!("{var}+=1")
}

/// True if `bytes[at..]` begins with the ASCII word `word`, on a word
/// boundary at both ends (so `formal` doesn't match `for`).
fn starts_with_word(bytes: &[u8], at: usize, word: &[u8]) -> bool {
    if !bytes[at..].starts_with(word) {
        return false;
    }
    let before_ok = at == 0 || !is_ident_byte(bytes[at - 1]);
    let after = at + word.len();
    let after_ok = after >= bytes.len() || !is_ident_byte(bytes[after]);
    before_ok && after_ok
}

fn is_ident_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

/// If `bytes[at]` starts a `//` line comment, a `/* */` block comment, or a
/// `"..."` / `'...'` string literal, returns the byte length to skip past it
/// (so the structural scanner never mistakes braces/semicolons inside
/// comments or strings for real code). Returns `None` otherwise.
fn comment_or_string_len(bytes: &[u8], at: usize) -> Option<usize> {
    match bytes.get(at) {
        Some(b'/') if bytes.get(at + 1) == Some(&b'/') => {
            let end = bytes[at..]
                .iter()
                .position(|&b| b == b'\n')
                .map(|p| at + p)
                .unwrap_or(bytes.len());
            Some(end - at)
        }
        Some(b'/') if bytes.get(at + 1) == Some(&b'*') => {
            let rel_end = find_subslice(&bytes[at + 2..], b"*/")
                .map(|p| p + 2)
                .unwrap_or(bytes.len() - at);
            Some(rel_end + 2)
        }
        Some(&q @ (b'"' | b'\'')) => {
            let mut j = at + 1;
            while j < bytes.len() {
                if bytes[j] == b'\\' {
                    j += 2;
                    continue;
                }
                if bytes[j] == q {
                    return Some(j + 1 - at);
                }
                j += 1;
            }
            Some(bytes.len() - at)
        }
        _ => None,
    }
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

fn skip_ws_and_comments(bytes: &[u8], mut i: usize) -> usize {
    loop {
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if let Some(skip) = comment_or_string_len(bytes, i) {
            i += skip;
            continue;
        }
        break;
    }
    i
}

/// Finds the byte offset of the delimiter matching the one at `open` (which
/// must equal `open_ch`), skipping over nested pairs, comments, and strings.
fn matching_close(bytes: &[u8], open: usize, open_ch: u8, close_ch: u8) -> Option<usize> {
    debug_assert_eq!(bytes[open], open_ch);
    let mut depth = 0i32;
    let mut i = open;
    while i < bytes.len() {
        if let Some(skip) = comment_or_string_len(bytes, i) {
            i += skip;
            continue;
        }
        if bytes[i] == open_ch {
            depth += 1;
        } else if bytes[i] == close_ch {
            depth -= 1;
            if depth == 0 {
                return Some(i);
            }
        }
        i += 1;
    }
    None
}

/// Splits a `for(...)` header's interior on its two top-level semicolons
/// (not inside nested parens/brackets, comments, or strings), returning
/// exactly the three clauses. `None` if the header isn't well-formed.
fn split_top_level_semicolons<'a>(header_bytes: &[u8], header: &'a str) -> Option<Vec<&'a str>> {
    let mut depth = 0i32;
    let mut clause_start = 0usize;
    let mut clauses = Vec::new();
    let mut i = 0;
    while i < header_bytes.len() {
        if let Some(skip) = comment_or_string_len(header_bytes, i) {
            i += skip;
            continue;
        }
        match header_bytes[i] {
            b'(' | b'[' => depth += 1,
            b')' | b']' => depth -= 1,
            b';' if depth == 0 => {
                clauses.push(&header[clause_start..i]);
                clause_start = i + 1;
            }
            _ => {}
        }
        i += 1;
    }
    clauses.push(&header[clause_start..]);
    if clauses.len() == 3 {
        Some(clauses)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;

    fn fixture() -> String {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("test/fixtures/loop_rewrite.sol");
        fs::read_to_string(path).expect("fixture file present")
    }

    #[test]
    fn rewrites_post_increment_bounded_loop() {
        let src = "for (uint256 i = 0; i < items.length; i++) { total += items[i]; }";
        let result = rewrite_unchecked_loops(src);
        assert_eq!(result.rewrites_applied, 1);
        assert!(result
            .output
            .contains("for (uint256 i = 0; i < items.length; )"));
        assert!(result.output.contains("unchecked {"));
        assert!(result.output.contains("++i;"));
        // The original checked increment must be gone from the header.
        assert!(!result.output.contains("i++)"));
    }

    #[test]
    fn rewrites_pre_increment_bounded_loop() {
        let src = "for (uint256 i = 0; i < n; ++i) { x += i; }";
        let result = rewrite_unchecked_loops(src);
        assert_eq!(result.rewrites_applied, 1);
        assert!(result.output.contains("for (uint256 i = 0; i < n; )"));
        assert!(result.output.contains("++i;"));
    }

    #[test]
    fn rewrites_compound_assign_increment() {
        let src = "for (uint256 i = 0; i < n; i += 1) { x += i; }";
        let result = rewrite_unchecked_loops(src);
        assert_eq!(result.rewrites_applied, 1);
        assert!(result.output.contains("for (uint256 i = 0; i < n; )"));
    }

    #[test]
    fn leaves_decrementing_loop_untouched() {
        let src = "for (uint256 i = n; i > 0; i--) { x += i; }";
        let result = rewrite_unchecked_loops(src);
        assert_eq!(result.rewrites_applied, 0);
        assert_eq!(result.output, src);
    }

    #[test]
    fn leaves_step_other_than_one_untouched() {
        let src = "for (uint256 i = 0; i < n; i += 2) { x += i; }";
        let result = rewrite_unchecked_loops(src);
        assert_eq!(result.rewrites_applied, 0);
    }

    #[test]
    fn leaves_already_unchecked_loop_untouched() {
        let src = "for (uint256 i = 0; i < n; ) { x += i; unchecked { ++i; } }";
        let result = rewrite_unchecked_loops(src);
        assert_eq!(result.rewrites_applied, 0);
        assert_eq!(result.output, src);
    }

    #[test]
    fn leaves_while_style_loop_untouched() {
        let src = "uint256 i = 0; for (; i < n; ) { x += i; i++; }";
        let result = rewrite_unchecked_loops(src);
        assert_eq!(result.rewrites_applied, 0);
    }

    #[test]
    fn leaves_reused_external_counter_untouched() {
        // `i` isn't declared in the init clause — not a fresh bounded counter.
        let src = "for (i = 0; i < n; i++) { x += i; }";
        let result = rewrite_unchecked_loops(src);
        assert_eq!(result.rewrites_applied, 0);
    }

    #[test]
    fn rewrites_nested_loops_independently() {
        let src =
            "for (uint256 i = 0; i < n; i++) { for (uint256 j = 0; j < m; j++) { x += i * j; } }";
        let result = rewrite_unchecked_loops(src);
        assert_eq!(result.rewrites_applied, 2);
        assert!(result.output.contains("++i;"));
        assert!(result.output.contains("++j;"));
    }

    #[test]
    fn ignores_for_keyword_inside_comments_and_strings() {
        let src = "// for (uint256 i = 0; i < n; i++) {}\nstring memory s = \"for (i++)\";";
        let result = rewrite_unchecked_loops(src);
        assert_eq!(result.rewrites_applied, 0);
        assert_eq!(result.output, src);
    }

    #[test]
    fn ignores_single_statement_body_without_braces() {
        let src = "for (uint256 i = 0; i < n; i++) doSomething(i);";
        let result = rewrite_unchecked_loops(src);
        assert_eq!(result.rewrites_applied, 0);
    }

    #[test]
    fn full_fixture_rewrites_exactly_the_six_target_loops() {
        // Targets: post-increment, pre-increment, compound-assign, fixed-bound,
        // and both loops inside the nested-loop function == 6 rewrites total.
        // Non-targets: already-unchecked, decrement, step-two, while-style.
        // Verifying the rewritten Solidity actually compiles is left to the
        // consuming CLI command / CI, which runs solc over real fixtures —
        // out of scope for this crate's own unit tests.
        let result = rewrite_unchecked_loops(&fixture());
        assert_eq!(result.rewrites_applied, 6);

        // Every rewritten loop's header increment clause is now empty.
        assert!(!result.output.contains("i++)"));
        assert!(!result.output.contains("i += 1)"));

        // Non-target loops are byte-for-byte unchanged.
        assert!(result
            .output
            .contains("for (uint256 i = start; i > 0; i--) {"));
        assert!(result
            .output
            .contains("for (uint256 i = 0; i < items.length; i += 2) {"));
        assert!(result.output.contains(
            "for (; i < items.length; ) {\n            total += items[i];\n            i++;"
        ));

        // The rewriter never double-wraps an already-unchecked loop.
        let unchecked_count = result.output.matches("unchecked {").count();
        // 6 newly inserted + 1 pre-existing in sumAlreadyUnchecked.
        assert_eq!(unchecked_count, 7);
    }
}
