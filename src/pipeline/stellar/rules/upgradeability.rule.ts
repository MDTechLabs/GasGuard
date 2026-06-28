import { BaseRule } from "../../../analysis/pipeline/base-rule";
import { RuleContext, RuleViolation } from "../../../analysis/pipeline/types";
import { SorobanRuleContext, toViolation } from "../types";
import { detectMissingUpgradeGuards } from "../../../../rules/stellar/upgradeability/detect-missing-upgrade-guards";

export class MissingUpgradeGuardRule extends BaseRule {
  id = "soroban/missing-upgrade-guard";
  name = "Missing Upgrade Guard";
  description = "Flags upgrade functions that lack admin authorisation.";

  getDependencies(): string[] {
    // Access-control scan must run first so its output can enrich context downstream
    return ["soroban/missing-access-control"];
  }

  async analyze(context: RuleContext): Promise<RuleViolation[]> {
    const { source, filePath } = context as SorobanRuleContext;
    const result = detectMissingUpgradeGuards(source);
    if (!result.detected) return [];
    return [
      toViolation(
        this.id,
        "missing-upgrade-guard",
        "critical",
        result.message,
        result.suggestion,
        filePath,
      ),
    ];
  }
}
