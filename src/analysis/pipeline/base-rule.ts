/**
 * Base class for implementing rules with dependency support
 * Simplifies rule creation while enabling dependency management
 */

import { IRule, RuleResult, RuleContext, RuleViolation } from './types';

export abstract class BaseRule implements IRule {
  abstract id: string;
  abstract name: string;
  abstract description: string;

  /**
   * Override to specify rule dependencies
   */
  getDependencies(): string[] {
    return [];
  }

  /**
   * Core rule logic to be implemented by subclasses
   * Returns violations found during analysis
   */
  abstract analyze(context: RuleContext): Promise<RuleViolation[]>;

  /**
   * Optional: Generate structured output for dependent rules
   */
  generateOutput(
    violations: RuleViolation[],
    context: RuleContext,
  ): Record<string, any> {
    return {
      violationCount: violations.length,
      violations,
    };
  }

  /**
   * Execute the rule - called by pipeline executor
   */
  async execute(context: RuleContext): Promise<RuleResult> {
    const violations = await this.analyze(context);
    const output = this.generateOutput(violations, context);

    return {
      ruleId: this.id,
      ruleName: this.name,
      violations,
      output,
    };
  }

  /**
   * Helper to get prior rule result
   */
  protected getPriorResult(ruleId: string, context: RuleContext): RuleResult | undefined {
    return context.priorResults.get(ruleId);
  }

  /**
   * Helper to safely access prior rule output data
   */
  protected getPriorOutput<T = any>(ruleId: string, context: RuleContext): T | undefined {
    const result = this.getPriorResult(ruleId, context);
    return result?.output as T;
  }
}
