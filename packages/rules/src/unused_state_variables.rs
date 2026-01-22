use crate::rule_engine::{
    extract_struct_fields, find_variable_usage, Rule, RuleViolation, ViolationSeverity,
};
use quote::ToTokens;
use std::collections::HashSet;
use syn::{Item, ItemImpl, ItemStruct, Meta};

pub struct UnusedStateVariablesRule;

impl Rule for UnusedStateVariablesRule {
    fn name(&self) -> &str {
        "unused-state-variables"
    }

    fn description(&self) -> &str {
        "Identifies state variables in Soroban contracts that are never read or written to, helping developers minimize storage footprint and ledger rent."
    }

    fn check(&self, ast: &[Item]) -> Vec<RuleViolation> {
        let mut violations = Vec::new();

        // Find all contract structs and their implementations
        let contract_structs = self.find_contract_structs(ast);
        let contract_impls = self.find_contract_impls(ast);

        for (struct_name, struct_item) in &contract_structs {
            // Get all state variables from the struct
            let state_variables = extract_struct_fields(struct_item);

            // Find the corresponding implementation
            if let Some(impl_block) = contract_impls.get(struct_name) {
                // Find all used variables in the implementation
                let used_variables = find_variable_usage(impl_block);

                // Check each state variable for usage
                for var_name in &state_variables {
                    if !self.is_variable_used(var_name, &used_variables) {
                        violations.push(RuleViolation {
                            rule_name: self.name().to_string(),
                            description: format!(
                                "State variable '{}' is declared but never used in contract '{}'. This wastes storage space and increases ledger rent costs.",
                                var_name, struct_name
                            ),
                            severity: ViolationSeverity::Warning,
                            line_number: 0, // Line number tracking requires proc-macro2 span features
                            column_number: 0,
                            variable_name: var_name.clone(),
                            suggestion: format!(
                                "Consider removing the unused state variable '{}' or implement functionality that uses it. If it's reserved for future use, add a comment explaining its purpose.",
                                var_name
                            ),
                        });
                    }
                }
            }
        }

        violations
    }
}

impl UnusedStateVariablesRule {
    fn find_contract_structs<'a>(&self, ast: &'a [Item]) -> Vec<(String, &'a ItemStruct)> {
        let mut contract_structs = Vec::new();

        for item in ast {
            if let Item::Struct(struct_item) = item {
                if self.is_soroban_contract(struct_item) {
                    let struct_name = struct_item.ident.to_string();
                    contract_structs.push((struct_name, struct_item));
                }
            }
        }

        contract_structs
    }

    fn find_contract_impls<'a>(
        &self,
        ast: &'a [Item],
    ) -> std::collections::HashMap<String, &'a ItemImpl> {
        let mut contract_impls = std::collections::HashMap::new();

        for item in ast {
            if let Item::Impl(impl_block) = item {
                let self_ty = &impl_block.self_ty;
                if let syn::Type::Path(type_path) = self_ty.as_ref() {
                    if let Some(segment) = type_path.path.segments.last() {
                        let struct_name = segment.ident.to_string();
                        contract_impls.insert(struct_name, impl_block);
                    }
                }
            }
        }

        contract_impls
    }

    fn is_soroban_contract(&self, struct_item: &ItemStruct) -> bool {
        // Check for Soroban contract attributes
        for attr in &struct_item.attrs {
            if let Meta::List(meta_list) = &attr.meta {
                let path_str = meta_list.path.to_token_stream().to_string();
                if path_str.contains("contractimpl")
                    || path_str.contains("contracttype")
                    || path_str.contains("stellar_contract")
                {
                    return true;
                }
            }
        }

        // Check for common Soroban trait implementations
        // This is a heuristic - in practice, we'd need to check if the struct
        // implements Soroban contract traits
        false
    }

    fn is_variable_used(&self, var_name: &str, used_variables: &HashSet<String>) -> bool {
        // Direct usage
        if used_variables.contains(var_name) {
            return true;
        }

        // Check for self.variable usage patterns
        let self_var_patterns = [format!("self.{}", var_name), format!("self?.{}", var_name)];

        for used_var in used_variables {
            for pattern in &self_var_patterns {
                if used_var.contains(pattern) {
                    return true;
                }
            }
        }

        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use quote::quote;

    #[test]
    fn test_unused_state_variable_detection() {
        let code = quote! {
            #[contracttype]
            pub struct MyContract {
                pub used_var: u64,
                pub unused_var: String,
                pub another_used: bool,
            }

            #[contractimpl]
            impl MyContract {
                pub fn new() -> Self {
                    Self {
                        used_var: 42,
                        another_used: true,
                        unused_var: "never_used".to_string(),
                    }
                }

                pub fn get_used_var(&self) -> u64 {
                    self.used_var
                }

                pub fn set_another_used(&mut self, value: bool) {
                    self.another_used = value;
                }
            }
        };

        let rule = UnusedStateVariablesRule;
        let file: syn::File = syn::parse2(code).unwrap();
        let violations = rule.check(&file.items);

        // Should find one unused variable
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].variable_name, "unused_var");
    }

    #[test]
    fn test_all_variables_used() {
        let code = quote! {
            #[contracttype]
            pub struct EfficientContract {
                pub counter: u64,
                pub owner: Address,
            }

            #[contractimpl]
            impl EfficientContract {
                pub fn new(owner: Address) -> Self {
                    Self {
                        counter: 0,
                        owner,
                    }
                }

                pub fn increment(&mut self) {
                    self.counter += 1;
                }

                pub fn get_owner(&self) -> &Address {
                    &self.owner
                }
            }
        };

        let rule = UnusedStateVariablesRule;
        let file: syn::File = syn::parse2(code).unwrap();
        let violations = rule.check(&file.items);

        // Should find no violations
        assert_eq!(violations.len(), 0);
    }
}
