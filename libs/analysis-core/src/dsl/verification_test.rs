// Verification test to demonstrate DSL is usable for rule creation
// This test demonstrates the complete workflow: DSL source -> compilation -> rule execution

#[cfg(test)]
mod verification_tests {
    use crate::dsl::compile_str;

    #[test]
    fn verify_dsl_creates_executable_rules() {
        // Define a simple DSL rule
        let dsl_source = r#"
            rule no-unsafe {
                name:        "No Unsafe Blocks"
                description: "Flags unsafe blocks in Rust code"
                severity:    error
                language:    rust
                when {
                    contains_pattern("unsafe")
                }
                message:    "Unsafe block detected at line {line}: {snippet}"
                suggestion: "Wrap in a safe abstraction"
            }
        "#;

        // Compile DSL into executable rules
        let rules = compile_str(dsl_source).expect("DSL compilation failed");

        // Verify rule was created
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].meta().id, "no-unsafe");
        assert_eq!(rules[0].meta().name, "No Unsafe Blocks");

        // Test rule fires on matching source
        let findings = rules[0].analyze("test.rs", "fn main() { unsafe { } }");
        assert!(!findings.is_empty(), "Rule should detect unsafe code");
        assert_eq!(findings[0].rule_id, "no-unsafe");

        // Test rule is silent on clean source
        let clean_findings = rules[0].analyze("clean.rs", "fn main() { println!(\"hello\"); }");
        assert!(clean_findings.is_empty(), "Rule should not flag clean code");
    }

    #[test]
    fn verify_complex_conditions() {
        let dsl_source = r#"
            rule complex-condition {
                name:        "Complex Condition"
                description: "Tests AND/OR/NOT logic"
                severity:    warning
                language:    rust
                when {
                    (contains_pattern("unsafe") or contains_pattern("panic")) 
                    and not contains_pattern("safe_wrapper")
                }
                message:    "Complex condition matched at line {line}"
            }
        "#;

        let rules = compile_str(dsl_source).expect("DSL compilation failed");
        assert_eq!(rules.len(), 1);

        // Should fire: has unsafe, no safe_wrapper
        let findings = rules[0].analyze("test.rs", "unsafe { }");
        assert!(!findings.is_empty());

        // Should not fire: has unsafe, but also has safe_wrapper
        let findings2 = rules[0].analyze("test.rs", "unsafe { } // safe_wrapper");
        assert!(findings2.is_empty());
    }

    #[test]
    fn verify_multiple_rules_in_single_file() {
        let dsl_source = r#"
            rule rule-a {
                name: "Rule A" description: "First rule" severity: info
                when { contains_pattern("TODO") }
                message: "TODO found at line {line}"
            }
            rule rule-b {
                name: "Rule B" description: "Second rule" severity: warning
                when { contains_pattern("FIXME") }
                message: "FIXME found at line {line}"
            }
        "#;

        let rules = compile_str(dsl_source).expect("DSL compilation failed");
        assert_eq!(rules.len(), 2);

        // Test rule-a fires
        let findings_a = rules[0].analyze("test.rs", "// TODO: fix this");
        assert!(!findings_a.is_empty());

        // Test rule-b fires
        let findings_b = rules[1].analyze("test.rs", "// FIXME: also this");
        assert!(!findings_b.is_empty());
    }

    #[test]
    fn verify_builtin_predicates_are_recognized() {
        // Test that all documented predicates are recognized (not unknown)
        let predicates = vec![
            ("contains_pattern", "(\"test\")"),
            ("matches_regex", "(\"test\")"),
            ("line_count_exceeds", "(100)"),
            ("function_count_exceeds", "(10)"),
            ("has_keyword", "(\"test\")"),
            ("lacks_keyword", "(\"test\")"),
            ("identifier_matches", "(\"test\")"),
            ("comment_ratio_below", "(0.1)"),
            ("nesting_depth_exceeds", "(5)"),
            ("always", "()"),
            ("never", "()"),
        ];

        for (pred, args) in predicates {
            let dsl_source = format!(
                r#"
                    rule test-{0} {{
                        name: "Test {0}" description: "Test" severity: info
                        when {{ {0}{1} }}
                        message: "Test"
                    }}
                "#,
                pred, args
            );

            let result = compile_str(&dsl_source);
            // We expect either success or a type error, but NOT "UnknownPredicate"
            if let Err(e) = result {
                let error_str = e.to_string();
                assert!(
                    !error_str.contains("UnknownPredicate"),
                    "Predicate {} should be recognized, got error: {}",
                    pred,
                    error_str
                );
            }
        }
    }
}
