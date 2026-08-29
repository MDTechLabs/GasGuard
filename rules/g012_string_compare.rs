//! G012 - Detect expensive string equality comparisons

use crate::ast::{
    BinaryOperation,
    BinaryOperator,
    Expression,
    FunctionCall,
    Identifier,
};
use crate::context::RuleContext;
use crate::rule::{Rule, RuleId};

pub struct G012StringCompare;

impl Default for G012StringCompare {
    fn default() -> Self {
        Self
    }
}

impl Rule for G012StringCompare {
    fn id(&self) -> RuleId {
        RuleId::G012
    }

    fn name(&self) -> &'static str {
        "string-compare"
    }

    fn description(&self) -> &'static str {
        "Detect dynamic string equality comparisons."
    }

    fn visit_binary_operation(
        &mut self,
        ctx: &mut RuleContext,
        node: &BinaryOperation,
    ) {
        // Only inspect == operations.
        if node.operator != BinaryOperator::Equal {
            return;
        }

        let left_is_hash = is_keccak_hash(&node.left);
        let right_is_hash = is_keccak_hash(&node.right);

        if left_is_hash && right_is_hash {
            ctx.report(
                self.id(),
                node.span(),
                "Use fixed bytes32 constants or hash identifiers instead of dynamic strings.",
            );
        }
    }
}

/// Detect:
///
/// keccak256(...)
///
/// This helper can be extended to specifically verify
/// abi.encodePacked(...) arguments if desired.
fn is_keccak_hash(expr: &Expression) -> bool {
    match expr {
        Expression::FunctionCall(FunctionCall {
            expression,
            ..
        }) => {
            matches!(
                expression.as_ref(),
                Expression::Identifier(Identifier { name, .. })
                if name == "keccak256"
            )
        }

        _ => false,
    }
}