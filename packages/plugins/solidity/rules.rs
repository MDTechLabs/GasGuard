use analysis_core::plugin::{BaseRule, Finding, Language, RuleMeta, Severity};

// ---------------------------------------------------------------------------
// SOL-001: Avoid using `string` storage variables (prefer `bytes32`)
// ---------------------------------------------------------------------------

pub struct StringStorageRule;

impl Default for StringStorageRule {
    fn default() -> Self { Self }
}

const SOL001_META: RuleMeta = RuleMeta {
    id: "SOL-001",
    name: "Prefer bytes32 over string for short fixed-length values",
    description: "Using `string` for storage variables that hold short, fixed-length data \
                  wastes gas.  Replacing them with `bytes32` is cheaper for reads/writes.",
    languages: &[Language::Solidity],
    default_severity: Severity::Warning,
};

impl BaseRule for StringStorageRule {
    fn meta(&self) -> &RuleMeta { &SOL001_META }

    fn analyze(&self, file_path: &str, source: &str) -> Vec<Finding> {
        let mut findings = Vec::new();
        for (i, line) in source.lines().enumerate() {
            // Very simplified pattern: `string public/private/internal <name>;`
            if line.contains("string ") && (line.contains("public") || line.contains("private") || line.contains("internal"))
                && line.trim_end().ends_with(';')
            {
                findings.push(Finding {
                    rule_id: self.meta().id.to_string(),
                    severity: Severity::Warning,
                    message: "Consider replacing `string` with `bytes32` if the value is short and fixed-length.".into(),
                    file: file_path.to_string(),
                    line: (i + 1) as u32,
                    column: None,
                    suggestion: Some(line.replace("string ", "bytes32 ")),
                });
            }
        }
        findings
    }
}

// ---------------------------------------------------------------------------
// SOL-002: Avoid redundant SLOAD (reading the same state var twice in a function)
// ---------------------------------------------------------------------------

pub struct RedundantSloadRule {
    seen: std::collections::HashSet<String>,
}

impl Default for RedundantSloadRule {
    fn default() -> Self { Self { seen: Default::default() } }
}

const SOL002_META: RuleMeta = RuleMeta {
    id: "SOL-002",
    name: "Cache state variables read more than once",
    description: "Each SLOAD costs 100–2100 gas.  Reading the same state variable \
                  multiple times within a single function should be cached in a local variable.",
    languages: &[Language::Solidity],
    default_severity: Severity::Warning,
};

impl BaseRule for RedundantSloadRule {
    fn meta(&self) -> &RuleMeta { &SOL002_META }

    fn on_start(&mut self) { self.seen.clear(); }

    fn analyze(&self, file_path: &str, source: &str) -> Vec<Finding> {
        let mut findings = Vec::new();
        let mut in_function = false;
        let mut var_counts: std::collections::HashMap<String, (u32, u32)> = Default::default(); // name -> (first_line, count)

        for (i, line) in source.lines().enumerate() {
            if line.contains("function ") { in_function = true; var_counts.clear(); }
            if in_function && line.contains('}') { in_function = false; }

            if in_function {
                // Naive: count occurrences of `self.<word>` patterns used in expressions
                for word in line.split_whitespace() {
                    let clean = word.trim_matches(|c: char| !c.is_alphanumeric() && c != '_');
                    if clean.len() > 2 {
                        let entry = var_counts.entry(clean.to_string()).or_insert((i as u32 + 1, 0));
                        entry.1 += 1;
                        if entry.1 == 2 {
                            findings.push(Finding {
                                rule_id: self.meta().id.to_string(),
                                severity: Severity::Warning,
                                message: format!("'{}' may be read from storage more than once — consider caching in a local variable.", clean),
                                file: file_path.to_string(),
                                line: i as u32 + 1,
                                column: None,
                                suggestion: Some(format!("uint256 cached_{clean} = {clean};  // use cached_{clean} below")),
                            });
                        }
                    }
                }
            }
        }
        findings
    }
}

// ---------------------------------------------------------------------------
// SOL-003: Unused Code Detection
// ---------------------------------------------------------------------------

pub struct UnusedCodeRule {
    declared_vars: std::collections::HashSet<String>,
    declared_functions: std::collections::HashSet<String>,
    used_vars: std::collections::HashSet<String>,
    used_functions: std::collections::HashSet<String>,
    imports: std::collections::HashSet<String>,
    used_imports: std::collections::HashSet<String>,
}

impl Default for UnusedCodeRule {
    fn default() -> Self { 
        Self { 
            declared_vars: Default::default(),
            declared_functions: Default::default(),
            used_vars: Default::default(),
            used_functions: Default::default(),
            imports: Default::default(),
            used_imports: Default::default(),
        } 
    }
}

const SOL003_META: RuleMeta = RuleMeta {
    id: "SOL-003",
    name: "Detect unused variables, functions, and imports",
    description: "Unused code increases gas costs unnecessarily. This rule identifies \
                  unused variables, functions, and imports that can be safely removed.",
    languages: &[Language::Solidity],
    default_severity: Severity::Warning,
};

impl BaseRule for UnusedCodeRule {
    fn meta(&self) -> &RuleMeta { &SOL003_META }

    fn on_start(&mut self) { 
        self.declared_vars.clear();
        self.declared_functions.clear();
        self.used_vars.clear();
        self.used_functions.clear();
        self.imports.clear();
        self.used_imports.clear();
    }

    fn analyze(&self, file_path: &str, source: &str) -> Vec<Finding> {
        let mut findings = Vec::new();
        
        // Local collections for this analysis
        let mut declared_vars: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut declared_functions: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut used_vars: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut used_functions: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut imports: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut used_imports: std::collections::HashSet<String> = std::collections::HashSet::new();
        
        // First pass: collect declarations
        for (i, line) in source.lines().enumerate() {
            let trimmed = line.trim();
            
            // Detect imports
            if trimmed.starts_with("import ") {
                if let Some(import_part) = trimmed.split_whitespace().nth(1) {
                    let import_name = import_part.trim_matches(';');
                    if !import_name.is_empty() {
                        // This is a simplified approach - in real implementation, we'd need proper parsing
                        imports.insert(import_name.to_string());
                    }
                }
            }
            
            // Detect function declarations
            if trimmed.contains("function ") {
                if let Some(func_part) = trimmed.split("function ").nth(1) {
                    if let Some(name_part) = func_part.split('(').next() {
                        let func_name = name_part.trim().split_whitespace().next().unwrap_or("").trim();
                        if !func_name.is_empty() && func_name != "{" {
                            declared_functions.insert(func_name.to_string());
                        }
                    }
                }
            }
            
            // Detect variable declarations (simplified)
            if (trimmed.contains("uint ") || trimmed.contains("address ") || 
                trimmed.contains("bool ") || trimmed.contains("string ") ||
                trimmed.contains("bytes ") || trimmed.contains("mapping ")) &&
               trimmed.contains(';') && !trimmed.contains("//") {
                
                for word in trimmed.split_whitespace() {
                    if word.contains(';') {
                        let var_name = word.trim_matches(';').trim_matches(',');
                        if !var_name.is_empty() && !var_name.contains('(') {
                            declared_vars.insert(var_name.to_string());
                        }
                    }
                }
            }
        }
        
        // Second pass: collect usage
        for (i, line) in source.lines().enumerate() {
            let trimmed = line.trim();
            
            // Skip comments and the line where the variable is declared
            if trimmed.starts_with("//") || trimmed.starts_with("/*") || trimmed.starts_with("*") {
                continue;
            }
            
            // Check function usage
            for func_name in &declared_functions {
                if line.contains(func_name) && !line.contains("function ") && 
                   !line.contains(&format!("function {}", func_name)) {
                    used_functions.insert(func_name.clone());
                }
            }
            
            // Check variable usage (simplified - would need proper AST parsing in production)
            for var_name in &declared_vars {
                if line.contains(var_name) && 
                   !line.contains(&format!("{} ", var_name)) && // Skip declaration
                   !line.contains(&format!("{};", var_name)) && // Skip declaration
                   !line.contains(&format!("{} =", var_name)) { // Skip assignment in declaration
                    used_vars.insert(var_name.clone());
                }
            }
            
            // Check import usage (simplified)
            for import_name in &imports {
                if line.contains(import_name) && !line.contains("import ") {
                    used_imports.insert(import_name.clone());
                }
            }
        }
        
        // Generate findings for unused items
        for (i, line) in source.lines().enumerate() {
            // Check unused variables
            for var_name in &declared_vars {
                if !used_vars.contains(var_name) && line.contains(var_name) {
                    findings.push(Finding {
                        rule_id: self.meta().id.to_string(),
                        severity: Severity::Warning,
                        message: format!("Variable '{}' is declared but never used. Consider removing it to save gas.", var_name),
                        file: file_path.to_string(),
                        line: (i + 1) as u32,
                        column: None,
                        suggestion: Some(format!("// Remove unused variable: {}", var_name)),
                    });
                }
            }
            
            // Check unused functions
            for func_name in &declared_functions {
                if !used_functions.contains(func_name) && line.contains(func_name) {
                    findings.push(Finding {
                        rule_id: self.meta().id.to_string(),
                        severity: Severity::Warning,
                        message: format!("Function '{}' is declared but never used. Consider removing it to save gas.", func_name),
                        file: file_path.to_string(),
                        line: (i + 1) as u32,
                        column: None,
                        suggestion: Some(format!("// Remove unused function: {}", func_name)),
                    });
                }
            }
            
            // Check unused imports
            for import_name in &imports {
                if !used_imports.contains(import_name) && line.contains(import_name) {
                    findings.push(Finding {
                        rule_id: self.meta().id.to_string(),
                        severity: Severity::Warning,
                        message: format!("Import '{}' is never used. Consider removing it to save gas.", import_name),
                        file: file_path.to_string(),
                        line: (i + 1) as u32,
                        column: None,
                        suggestion: Some(format!("// Remove unused import: {}", import_name)),
                    });
                }
            }
        }
        
        findings
    }
}