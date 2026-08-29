use crate::{
    context::RuleContext,
    diagnostic::{Diagnostic, Severity},
    rule::{Rule, RuleCategory},
};

pub struct G014StorageArrayLength;

impl Rule for G014StorageArrayLength {
    fn id(&self) -> &'static str {
        "G014"
    }

    fn name(&self) -> &'static str {
        "Storage array length access inside loops"
    }

    fn category(&self) -> RuleCategory {
        RuleCategory::GasOptimization
    }

    fn description(&self) -> &'static str {
        "Detect repeated storage array length reads that should be cached."
    }

    fn check(&self, ctx: &mut RuleContext) {
        for node in ctx.nodes() {
            // Find `.length`
            if let Some(member) = node.as_member_access() {
                if member.member_name() != "length" {
                    continue;
                }

                // Ignore memory/calldata arrays
                if !member.base().is_storage_array() {
                    continue;
                }

                // Only warn if inside loop or conditional
                if !(ctx.is_inside_loop(node) || ctx.is_inside_conditional(node)) {
                    continue;
                }

                // Skip if already cached
                if ctx.is_cached_to_local(member.base()) {
                    continue;
                }

                ctx.report(
                    Diagnostic::new(
                        Severity::Warning,
                        "Storage array length is repeatedly loaded from storage."
                    )
                    .with_rule(self.id())
                    .with_location(node.location())
                    .with_help(
                        "Cache storageArray.length in a local variable before the loop."
                    ),
                );
            }
        }
    }
}