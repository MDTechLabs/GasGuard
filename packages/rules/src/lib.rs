pub mod rule_engine;
pub mod unused_state_variables;
pub mod vyper;
pub mod soroban;
pub mod stellar;
pub mod optimization;
pub mod solidity;
pub mod security;

// Explicitly export core types to avoid ambiguity
pub use rule_engine::{Rule, RuleEngine, RuleViolation, ViolationSeverity, extract_struct_fields, find_variable_usage};
pub use unused_state_variables::UnusedStateVariablesRule;
pub use solidity::StateVariablePackingRule;
pub use optimization::storage::{
    detect_packing_opportunities,
    find_consecutive_packable_groups,
    get_type_size,
    is_packable_type,
    PackingOpportunity,
    VariableInfo,
};
pub use optimization::deployment::{estimate_bytecode_size, ExcessiveContractSizeRule};
pub use security::HardcodedAddressesRule;

// Export Soroban types specifically
pub use soroban::{
    SorobanAnalyzer, 
    SorobanContract, 
    SorobanParser, 
    SorobanResult, 
    SorobanRuleEngine,
    SorobanStruct,
    SorobanImpl,
    SorobanFunction,
    SorobanField,
    SorobanParam
};

// Export Vyper types (keeping glob here is fine if Vyper module is clean, but let's be safe)
pub use vyper::*;