import { RuleContext, RuleViolation } from "../../analysis/pipeline/types";

/** Shared context shape for all Soroban pipeline rules */
export interface SorobanRuleContext extends RuleContext {
  /** Raw Soroban contract source */
  source: string;
  /** File path of the contract being analysed */
  filePath: string;
}

export function toViolation(
  ruleId: string,
  type: string,
  severity: RuleViolation["severity"],
  message: string,
  suggestion: string,
  filePath: string,
  metadata?: Record<string, unknown>,
): RuleViolation {
  return {
    ruleId,
    type,
    severity,
    message,
    location: { file: filePath },
    metadata: suggestion ? { ...metadata, suggestion } : metadata,
  };
}
