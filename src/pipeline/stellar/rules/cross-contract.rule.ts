import { BaseRule } from "../../../analysis/pipeline/base-rule";
import { RuleContext, RuleViolation } from "../../../analysis/pipeline/types";
import { SorobanRuleContext, toViolation } from "../types";
import { detectUnsafeCrossContractInvocation } from "../../../../rules/stellar/cross-contract/detect-unsafe-cross-contract-invocation";

export class UnsafeCrossContractRule extends BaseRule {
  id = "soroban/unsafe-cross-contract";
  name = "Unsafe Cross-Contract Invocation";
  description =
    "Flags cross-contract calls without caller validation or result checks.";

  async analyze(context: RuleContext): Promise<RuleViolation[]> {
    const { source, filePath } = context as SorobanRuleContext;
    const result = detectUnsafeCrossContractInvocation(source);
    if (!result.detected) return [];
    return [
      toViolation(
        this.id,
        "unsafe-cross-contract",
        "high",
        result.message,
        result.suggestion,
        filePath,
      ),
    ];
  }
}
