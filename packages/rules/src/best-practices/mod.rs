pub mod config;
pub mod use_safe_int_types;
pub mod use_immutable_storage;
pub mod use_checked_arithmetic;
pub mod use_result_types;
pub mod use_initialization_functions;

pub use config::{BestPracticeRuleConfig, BestPracticesConfig, default_best_practices_config};
pub use use_safe_int_types::UseSafeIntTypesRule;
pub use use_immutable_storage::UseImmutableStorageRule;
pub use use_checked_arithmetic::UseCheckedArithmeticRule;
pub use use_result_types::UseResultTypesRule;
pub use use_initialization_functions::UseInitializationFunctionsRule;

use crate::soroban::SorobanRule;

pub fn default_best_practice_rules() -> Vec<Box<dyn SorobanRule>> {
    vec![
        Box::new(UseSafeIntTypesRule::default()),
        Box::new(UseImmutableStorageRule::default()),
        Box::new(UseCheckedArithmeticRule::default()),
        Box::new(UseResultTypesRule::default()),
        Box::new(UseInitializationFunctionsRule::default()),
    ]
}
