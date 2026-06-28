import { BaseRule } from "../../../analysis/pipeline/base-rule";
import { RuleContext, RuleViolation } from "../../../analysis/pipeline/types";
import { SorobanRuleContext, toViolation } from "../types";
import { detectExcessiveEventTopics } from "../../../../rules/stellar/events/detect-excessive-event-topics";

export class ExcessiveEventTopicsRule extends BaseRule {
  id = "soroban/excessive-event-topics";
  name = "Excessive Event Topics";
  description =
    "Flags events with too many topics or oversized topic payloads.";

  async analyze(context: RuleContext): Promise<RuleViolation[]> {
    const { source, filePath } = context as SorobanRuleContext;
    const result = detectExcessiveEventTopics(source);
    if (!result.detected) return [];
    return [
      toViolation(
        this.id,
        "excessive-event-topics",
        "warning",
        result.message,
        result.suggestion,
        filePath,
        { violations: result.violations },
      ),
    ];
  }
}
