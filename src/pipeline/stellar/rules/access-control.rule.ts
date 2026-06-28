import { BaseRule } from "../../../analysis/pipeline/base-rule";
import { RuleContext, RuleViolation } from "../../../analysis/pipeline/types";
import { SorobanRuleContext, toViolation } from "../types";
import { detectMissingAccessControl } from "../../../../rules/stellar/access-control/detect-missing-access-control";
import { detectWeakRoleHierarchies } from "../../../../rules/stellar/access-control/detect-weak-role-hierarchies";

export class MissingAccessControlRule extends BaseRule {
  id = "soroban/missing-access-control";
  name = "Missing Access Control";
  description = "Flags privileged functions that lack role validation.";

  async analyze(context: RuleContext): Promise<RuleViolation[]> {
    const { source, filePath } = context as SorobanRuleContext;
    const result = detectMissingAccessControl(source);
    if (!result.detected) return [];
    return [
      toViolation(
        this.id,
        "missing-access-control",
        "high",
        result.message,
        result.suggestion,
        filePath,
        { flaggedFunctions: result.flaggedFunctions },
      ),
    ];
  }
}

export class WeakRoleHierarchyRule extends BaseRule {
  id = "soroban/weak-role-hierarchy";
  name = "Weak Role Hierarchy";
  description =
    "Flags role-assignment functions without a superior-authority check.";

  async analyze(context: RuleContext): Promise<RuleViolation[]> {
    const { source, filePath } = context as SorobanRuleContext;
    const result = detectWeakRoleHierarchies(source);
    if (!result.detected) return [];
    return [
      toViolation(
        this.id,
        "weak-role-hierarchy",
        "high",
        result.message,
        result.suggestion,
        filePath,
        { weakRoles: result.weakRoles },
      ),
    ];
  }
}
