import { BaseRule } from "../../../analysis/pipeline/base-rule";
import { RuleContext, RuleViolation } from "../../../analysis/pipeline/types";
import { SorobanRuleContext, toViolation } from "../types";
import { detectInconsistentVisibility } from "../../../../rules/stellar/security/visibility/detect-inconsistent-visibility";

export class InconsistentVisibilityRule extends BaseRule {
  id = "soroban/inconsistent-visibility";
  name = "Inconsistent Function Visibility";
  description =
    "Flags pub fn declarations inside #[contractimpl] that should be private.";

  async analyze(context: RuleContext): Promise<RuleViolation[]> {
    const { source, filePath } = context as SorobanRuleContext;
    const result = detectInconsistentVisibility(source);
    if (!result.detected) return [];
    return result.violations.map((v) =>
      toViolation(
        this.id,
        `visibility/${v.kind}`,
        "medium",
        `${v.functionName}: ${v.reason}`,
        result.suggestion,
        filePath,
        { functionName: v.functionName, line: v.line, kind: v.kind },
      ),
    );
  }
}
