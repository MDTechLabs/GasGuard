pub mod arrays;
pub mod deployment;
pub mod encoding;
pub mod storage;
pub mod visibility;

pub use arrays::detect_dynamic_array_deletions;
pub use storage::{
    detect_packing_opportunities, find_consecutive_packable_groups, get_type_size,
    is_packable_type, PackingOpportunity, VariableInfo,
};

pub use deployment::{estimate_bytecode_size, ExcessiveContractSizeRule};
pub use encoding::detect_abi_encoding_inefficiencies;
pub use visibility::{check_unnecessary_public_functions, UnnecessaryPublicFunctionRule};
