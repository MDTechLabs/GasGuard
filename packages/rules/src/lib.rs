pub mod auditability;
pub mod optimization;
pub mod rule_engine;
pub mod security;
pub mod solidity;
pub mod soroban;
pub mod stellar;
pub mod unused_state_variables;
pub mod vyper;

// Explicitly export core types to avoid ambiguity
pub use optimization::deployment::{estimate_bytecode_size, ExcessiveContractSizeRule};
pub use optimization::storage::{
    detect_packing_opportunities,
    find_consecutive_packable_groups,
    get_type_size,
    PackingOpportunity,
    VariableInfo,
};
pub use security::{HardcodedAddressesRule, MissingDomainSeparationRule, defi::MissingSlippageValidationRule};
pub use solidity::{StateVariablePackingRule, MappingIterationRule, AbiEncodingRule};
pub use optimization::storage::detect_mapping_iteration;
pub use unused_state_variables::UnusedStateVariablesRule;

// Export Soroban types specifically
pub use soroban::{
    InefficientBytesAllocationRule, SorobanAnalyzer, SorobanContract, SorobanField,
    SorobanFunction, SorobanImpl, SorobanParam, SorobanParser, SorobanResult, SorobanRuleEngine,
    SorobanStruct,
};

// Export Vyper types (keeping glob here is fine if Vyper module is clean, but let's be safe)
pub use vyper::*;
