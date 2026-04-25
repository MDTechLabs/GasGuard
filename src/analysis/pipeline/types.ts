/**
 * Core types for rule dependency pipeline system
 * Enables rules to depend on outputs of other rules for optimized analysis
 */

/** Result from a single rule execution */
export interface RuleResult {
  ruleId: string;
  ruleName: string;
  violations: RuleViolation[];
  output: Record<string, any>;
}

/** Violation found by a rule */
export interface RuleViolation {
  ruleId: string;
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'warning' | 'info';
  message: string;
  location?: {
    file?: string;
    line?: number;
    column?: number;
  };
  metadata?: Record<string, any>;
}

/** Context passed between rules in execution order */
export interface RuleContext {
  /** Results from previously executed rules */
  priorResults: Map<string, RuleResult>;
  /** Configuration available to all rules */
  config?: Record<string, any>;
  /** AST or code being analyzed */
  ast?: any;
}

/** Contract for all rules in the pipeline */
export interface IRule {
  id: string;
  name: string;
  description: string;
  
  /** Rule IDs that must execute before this rule */
  getDependencies(): string[];
  
  /** Execute the rule and return violations */
  execute(context: RuleContext): Promise<RuleResult>;
}

/** Error types for dependency resolution */
export enum PipelineErrorType {
  CIRCULAR_DEPENDENCY = 'CIRCULAR_DEPENDENCY',
  MISSING_DEPENDENCY = 'MISSING_DEPENDENCY',
  INVALID_EXECUTION_ORDER = 'INVALID_EXECUTION_ORDER',
  RULE_EXECUTION_ERROR = 'RULE_EXECUTION_ERROR',
  DUPLICATE_RULE_ID = 'DUPLICATE_RULE_ID',
}

/** Pipeline execution error */
export interface IPipelineError {
  type: PipelineErrorType;
  message: string;
  details?: any;
}

/** Execution result */
export interface ExecutionResult {
  success: boolean;
  allViolations: RuleViolation[];
  ruleResults: Map<string, RuleResult>;
  executionOrder: string[];
  errors?: IPipelineError[];
  executionTime: number;
}
