use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use syn::{Expr, Item, ItemImpl, ItemStruct, Member, Pat};

// Re-export from soroban module
pub use crate::soroban::{SorobanRuleEngine, SorobanContract, SorobanParser, SorobanResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleViolation {
    pub rule_name: String,
    pub description: String,
    pub severity: ViolationSeverity,
    pub line_number: usize,
    pub column_number: usize,
    pub variable_name: String,
    pub suggestion: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ViolationSeverity {
    Error,
    Warning,
    Info,
}

pub trait Rule {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn check(&self, ast: &[Item]) -> Vec<RuleViolation>;
}

pub struct RuleEngine {
    rules: Vec<Box<dyn Rule>>,
}

impl RuleEngine {
    pub fn new() -> Self {
        Self { rules: Vec::new() }
    }

    pub fn add_rule(mut self, rule: Box<dyn Rule>) -> Self {
        self.rules.push(rule);
        self
    }

    pub fn analyze(&self, code: &str) -> Result<Vec<RuleViolation>, String> {
        let ast = syn::parse_file(code).map_err(|e| format!("Failed to parse Rust code: {}", e))?;

        let mut violations = Vec::new();
        for rule in &self.rules {
            violations.extend(rule.check(&ast.items));
        }

        Ok(violations)
    }
}

// Helper functions for AST analysis
pub fn extract_struct_fields(struct_item: &ItemStruct) -> Vec<String> {
    struct_item
        .fields
        .iter()
        .filter_map(|field| field.ident.as_ref().map(|ident| ident.to_string()))
        .collect()
}

pub fn find_variable_usage(impl_block: &ItemImpl) -> HashSet<String> {
    let mut used_vars = HashSet::new();

    for item in &impl_block.items {
        if let syn::ImplItem::Fn(method) = item {
            // Check method body for variable usage
            for stmt in &method.block.stmts {
                extract_variables_from_stmt(stmt, &mut used_vars);
            }
        }
    }

    used_vars
}

fn extract_variables_from_stmt(stmt: &syn::Stmt, used_vars: &mut HashSet<String>) {
    match stmt {
        syn::Stmt::Local(local) => {
            extract_variables_from_pat(&local.pat, used_vars);
            if let Some(init) = &local.init {
                extract_variables_from_expr(&init.expr, used_vars);
            }
        }
        syn::Stmt::Item(_) => {}
        syn::Stmt::Expr(expr, _) => {
            extract_variables_from_expr(expr, used_vars);
        }
        syn::Stmt::Macro(_) => {}
    }
}

fn extract_variables_from_expr(expr: &Expr, used_vars: &mut HashSet<String>) {
    match expr {
        Expr::Path(path) => {
            if let Some(segment) = path.path.segments.last() {
                let ident = segment.ident.to_string();
                // Skip common Rust keywords and types
                if !is_rust_keyword(&ident) {
                    used_vars.insert(ident);
                }
            }
        }
        Expr::Field(field) => {
            extract_variables_from_expr(&field.base, used_vars);
            if let Member::Named(ident) = &field.member {
                used_vars.insert(ident.to_string());
            }
        }
        Expr::MethodCall(method_call) => {
            extract_variables_from_expr(&method_call.receiver, used_vars);
            for arg in &method_call.args {
                extract_variables_from_expr(arg, used_vars);
            }
        }
        Expr::Binary(binary) => {
            extract_variables_from_expr(&binary.left, used_vars);
            extract_variables_from_expr(&binary.right, used_vars);
        }
        Expr::Unary(unary) => {
            extract_variables_from_expr(&unary.expr, used_vars);
        }
        Expr::Call(call) => {
            extract_variables_from_expr(&call.func, used_vars);
            for arg in &call.args {
                extract_variables_from_expr(arg, used_vars);
            }
        }
        Expr::Block(block) => {
            for stmt in &block.block.stmts {
                extract_variables_from_stmt(stmt, used_vars);
            }
        }
        Expr::If(if_expr) => {
            extract_variables_from_expr(&if_expr.cond, used_vars);
            for stmt in &if_expr.then_branch.stmts {
                extract_variables_from_stmt(stmt, used_vars);
            }
            if let Some((_, else_branch)) = &if_expr.else_branch {
                extract_variables_from_expr(else_branch, used_vars);
            }
        }
        Expr::Match(match_expr) => {
            extract_variables_from_expr(&match_expr.expr, used_vars);
            for arm in &match_expr.arms {
                extract_variables_from_expr(&arm.body, used_vars);
            }
        }
        Expr::While(while_expr) => {
            extract_variables_from_expr(&while_expr.cond, used_vars);
            for stmt in &while_expr.body.stmts {
                extract_variables_from_stmt(stmt, used_vars);
            }
        }
        Expr::ForLoop(for_loop) => {
            extract_variables_from_pat(&for_loop.pat, used_vars);
            extract_variables_from_expr(&for_loop.expr, used_vars);
            for stmt in &for_loop.body.stmts {
                extract_variables_from_stmt(stmt, used_vars);
            }
        }
        Expr::Return(ret) => {
            if let Some(expr) = &ret.expr {
                extract_variables_from_expr(expr, used_vars);
            }
        }
        Expr::Struct(struct_expr) => {
            for field in &struct_expr.fields {
                extract_variables_from_expr(&field.expr, used_vars);
            }
            if let Some(rest) = &struct_expr.rest {
                extract_variables_from_expr(rest, used_vars);
            }
        }
        _ => {}
    }
}

fn extract_variables_from_pat(pat: &Pat, used_vars: &mut HashSet<String>) {
    match pat {
        Pat::Ident(pat_ident) => {
            used_vars.insert(pat_ident.ident.to_string());
        }
        Pat::Struct(pat_struct) => {
            for field in &pat_struct.fields {
                extract_variables_from_pat(&field.pat, used_vars);
            }
        }
        Pat::Tuple(tuple) => {
            for elem in &tuple.elems {
                extract_variables_from_pat(elem, used_vars);
            }
        }
        Pat::TupleStruct(tuple_struct) => {
            for elem in &tuple_struct.elems {
                extract_variables_from_pat(elem, used_vars);
            }
        }
        Pat::Reference(pat_ref) => {
            extract_variables_from_pat(&pat_ref.pat, used_vars);
        }
        _ => {}
    }
}

fn is_rust_keyword(ident: &str) -> bool {
    matches!(
        ident,
        "self"
            | "Self"
            | "super"
            | "crate"
            | "mod"
            | "use"
            | "pub"
            | "const"
            | "static"
            | "let"
            | "fn"
            | "struct"
            | "enum"
            | "impl"
            | "trait"
            | "where"
            | "for"
            | "while"
            | "loop"
            | "if"
            | "else"
            | "match"
            | "break"
            | "continue"
            | "return"
            | "async"
            | "await"
            | "move"
            | "ref"
            | "mut"
            | "unsafe"
            | "extern"
            | "type"
            | "union"
            | "macro"
            | "Some"
            | "None"
            | "Ok"
            | "Err"
            | "Result"
            | "Option"
            | "Vec"
            | "String"
            | "str"
            | "bool"
            | "u8"
            | "u16"
            | "u32"
            | "u64"
            | "u128"
            | "i8"
            | "i16"
            | "i32"
            | "i64"
            | "i128"
            | "f32"
            | "f64"
            | "usize"
            | "isize"
    )
}
