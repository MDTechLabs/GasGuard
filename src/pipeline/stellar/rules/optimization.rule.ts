import { BaseRule } from "../../../analysis/pipeline/base-rule";
import { RuleContext, RuleViolation } from "../../../analysis/pipeline/types";
import { SorobanRuleContext, toViolation } from "../types";
import { detectInefficientSymbolUsage } from "../../../../rules/stellar/optimization/detect-inefficient-symbol-usage";

export class InefficientSymbolUsageRule extends BaseRule {
  id = "soroban/inefficient-symbol-usage";
  name = "Inefficient Symbol Usage";
  description =
    "Flags repeated inline Symbol construction that should use static references.";

  async analyze(context: RuleContext): Promise<RuleViolation[]> {
    const { source, filePath } = context as SorobanRuleContext;
    const result = detectInefficientSymbolUsage(source);
    if (!result.detected) return [];
    return [
      toViolation(
        this.id,
        "inefficient-symbol-usage",
        "warning",
        result.message,
        result.suggestion,
        filePath,
        { repeated: result.repeated },
      ),
    ];
  }
}
