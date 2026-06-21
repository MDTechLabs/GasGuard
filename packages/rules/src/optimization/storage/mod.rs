pub mod state_variable_packing;
pub mod multiple_storage_reads;
pub mod mapping_iteration;

pub use state_variable_packing::{
    detect_packing_opportunities, find_consecutive_packable_groups, get_type_size,
    is_packable_type, PackingOpportunity, VariableInfo,
};
pub use mapping_iteration::detect_mapping_iteration;
