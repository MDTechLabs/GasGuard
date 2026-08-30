export interface StorageRuleViolation {
  ruleId: string;
  ruleName: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  suggestion: string;
  line: number;
  column?: number;
  key?: string;
  functionName?: string;
}

export interface RuleContext {
  fileName?: string;
  options?: Record<string, any>;
}
