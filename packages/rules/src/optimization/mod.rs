pub mod deployment;
pub mod storage;

pub use storage::{
    detect_packing_opportunities, find_consecutive_packable_groups, get_type_size,
    is_packable_type, PackingOpportunity, VariableInfo,
};

pub use deployment::{estimate_bytecode_size, ExcessiveContractSizeRule};
