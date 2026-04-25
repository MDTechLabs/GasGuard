/**
 * Pipeline executor that runs rules in dependency order
 * Ensures rules have access to prior analysis context
 */

import {
  IRule,
  RuleContext,
  ExecutionResult,
  PipelineErrorType,
  IPipelineError,
} from './types';
import { RuleDependencyGraph } from './rule-dependency-graph';

export class PipelineExecutor {
  private rules: Map<string, IRule> = new Map();
  private graph: RuleDependencyGraph = new RuleDependencyGraph();
  private validationErrors: IPipelineError[] = [];

  constructor() {}

  /**
   * Register a rule in the pipeline
   */
  registerRule(rule: IRule): void {
    if (this.rules.has(rule.id)) {
      throw new Error(`Rule '${rule.id}' is already registered`);
    }

    this.rules.set(rule.id, rule);
    this.graph.addRule(rule.id, rule.getDependencies());
  }

  /**
   * Register multiple rules at once
   */
  registerRules(rules: IRule[]): void {
    for (const rule of rules) {
      this.registerRule(rule);
    }
  }

  /**
   * Validate the pipeline configuration
   */
  validate(): boolean {
    this.validationErrors = this.graph.validate();
    return this.validationErrors.length === 0;
  }

  /**
   * Get validation errors
   */
  getValidationErrors(): IPipelineError[] {
    return [...this.validationErrors];
  }

  /**
   * Get the execution order of rules based on dependencies
   */
  getExecutionOrder(): string[] | null {
    return this.graph.topologicalSort();
  }

  /**
   * Execute all rules in dependency order
   */
  async execute(context: Omit<RuleContext, 'priorResults'>): Promise<ExecutionResult> {
    const startTime = Date.now();
    const result: ExecutionResult = {
      success: false,
      allViolations: [],
      ruleResults: new Map(),
      executionOrder: [],
      errors: [],
      executionTime: 0,
    };

    // Validate pipeline
    if (!this.validate()) {
      result.errors = this.validationErrors;
      result.executionTime = Date.now() - startTime;
      return result;
    }

    // Get execution order
    const executionOrder = this.getExecutionOrder();
    if (!executionOrder) {
      result.errors = [
        {
          type: PipelineErrorType.INVALID_EXECUTION_ORDER,
          message: 'Failed to determine execution order - possible circular dependency',
        },
      ];
      result.executionTime = Date.now() - startTime;
      return result;
    }

    result.executionOrder = executionOrder;

    // Execute rules in order
    for (const ruleId of executionOrder) {
      try {
        const rule = this.rules.get(ruleId);
        if (!rule) {
          result.errors?.push({
            type: PipelineErrorType.RULE_EXECUTION_ERROR,
            message: `Rule '${ruleId}' not found in registry`,
          });
          continue;
        }

        // Create context with prior results
        const ruleContext: RuleContext = {
          ...context,
          priorResults: result.ruleResults,
        };

        // Execute the rule
        const ruleResult = await rule.execute(ruleContext);

        // Store result
        result.ruleResults.set(ruleId, ruleResult);
        result.allViolations.push(...ruleResult.violations);
      } catch (error) {
        result.errors?.push({
          type: PipelineErrorType.RULE_EXECUTION_ERROR,
          message: `Error executing rule '${ruleId}': ${error instanceof Error ? error.message : String(error)}`,
          details: error,
        });
      }
    }

    result.success = result.errors?.length === 0;
    result.executionTime = Date.now() - startTime;

    return result;
  }

  /**
   * Execute a specific rule and its dependencies only
   */
  async executeRule(
    ruleId: string,
    context: Omit<RuleContext, 'priorResults'>,
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const result: ExecutionResult = {
      success: false,
      allViolations: [],
      ruleResults: new Map(),
      executionOrder: [],
      errors: [],
      executionTime: 0,
    };

    if (!this.rules.has(ruleId)) {
      result.errors = [
        {
          type: PipelineErrorType.RULE_EXECUTION_ERROR,
          message: `Rule '${ruleId}' not found`,
        },
      ];
      result.executionTime = Date.now() - startTime;
      return result;
    }

    // Get all transitive dependencies
    const deps = this.graph.getAllTransitiveDependencies(ruleId);
    deps.add(ruleId);

    // Build execution order for just these rules
    const allExecutionOrder = this.getExecutionOrder();
    if (!allExecutionOrder) {
      result.errors = [
        {
          type: PipelineErrorType.INVALID_EXECUTION_ORDER,
          message: 'Failed to determine execution order',
        },
      ];
      result.executionTime = Date.now() - startTime;
      return result;
    }

    const executionOrder = allExecutionOrder.filter((id) => deps.has(id));
    result.executionOrder = executionOrder;

    // Execute selected rules
    for (const id of executionOrder) {
      try {
        const rule = this.rules.get(id);
        if (!rule) {
          continue;
        }

        const ruleContext: RuleContext = {
          ...context,
          priorResults: result.ruleResults,
        };

        const ruleResult = await rule.execute(ruleContext);
        result.ruleResults.set(id, ruleResult);
        result.allViolations.push(...ruleResult.violations);
      } catch (error) {
        result.errors?.push({
          type: PipelineErrorType.RULE_EXECUTION_ERROR,
          message: `Error executing rule '${id}': ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    result.success = result.errors?.length === 0;
    result.executionTime = Date.now() - startTime;

    return result;
  }
}
