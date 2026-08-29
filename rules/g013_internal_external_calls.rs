//! G013 - Detect redundant external self-invocations
//!
//! Detects usages of:
//!     this.someFunction();
//!
//! Instead of:
//!     someFunction();
//!
//! Calling a function through `this` performs an external call,
//! which is significantly more expensive than an internal jump.

use crate::ast::{
    Expression,
    FunctionCall,
    Identifier,
    MemberAccess,
};
use crate::context::RuleContext;
use crate::rule::{Rule, RuleId};

pub struct G013InternalExternalCalls;

impl Default for G013InternalExternalCalls {
    fn default() -> Self {
        Self
    }
}

impl Rule for G013InternalExternalCalls {
    fn id(&self) -> RuleId {
        RuleId::G013
    }

    fn name(&self) -> &'static str {
        "internal-external-calls"
    }

    fn description(&self) -> &'static str {
        "Detect redundant self external calls using `this.function()`."
    }

    fn visit_function_call(
        &mut self,
        ctx: &mut RuleContext,
        call: &FunctionCall,
    ) {
        // Check whether the function call expression is a member access.
        if let Expression::MemberAccess(MemberAccess {
            expression,
            member_name,
            ..
        }) = &call.expression
        {
            // Ensure the member access is performed on `this`.
            if let Expression::Identifier(Identifier { name, .. }) = expression.as_ref() {
                if name == "this" {
                    ctx.report(
                        self.id(),
                        call.span(),
                        format!(
                            "Replace external `this.{}` invocation with an internal function call.",
                            member_name
                        ),
                    );
                }
            }
        }
    }
}