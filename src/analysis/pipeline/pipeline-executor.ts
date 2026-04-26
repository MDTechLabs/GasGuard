/**
 * Pipeline executor that runs rules in dependency order with parallel execution
 * Ensures rules have access to prior analysis context while optimizing performance
 */

import {
  IRule,
  RuleContext,
  ExecutionResult,
  PipelineErrorType,
  IPipelineError,
} from './types';
import { RuleDependencyGraph } from './rule-dependency-graph';
import { optimizeRuleSet } from './rule-set-optimizer';

export class PipelineExecutor {
  private rules: Map<string, IRule> = new Map();
  private graph: RuleDependencyGraph = new RuleDependencyGraph();
  private validationErrors: IPipelineError[] = [];
  private optimizationNotes: string[] = [];
  private maxConcurrency: number;
  private enableParallelExecution: boolean;

  constructor(options: { maxConcurrency?: number; enableParallelExecution?: boolean } = {}) {
    this.maxConcurrency = options.maxConcurrency || 4;
    this.enableParallelExecution = options.enableParallelExecution !== false;
  }

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
    const optimized = optimizeRuleSet(rules);
    for (const rule of optimized.optimizedRules) {
      this.registerRule(rule);
    }

    for (const removed of optimized.removedRules) {
      this.optimizationNotes.push(
        removed.reason === 'duplicate-id'
          ? `Removed duplicate rule '${removed.removedRuleId}' (kept '${removed.keptRuleId}')`
          : `Removed overlapping rule '${removed.removedRuleId}' (kept '${removed.keptRuleId}')`,
      );
    }
  }

  getOptimizationNotes(): string[] {
    return [...this.optimizationNotes];
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
   * Execute all rules in dependency order with parallel execution where possible
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

    if (this.enableParallelExecution) {
      await this.executeParallel(executionOrder, context, result);
    } else {
      await this.executeSequential(executionOrder, context, result);
    }

    result.success = result.errors?.length === 0;
    result.executionTime = Date.now() - startTime;

    return result;
  }

  /**
   * Execute rules sequentially (original behavior)
   */
  private async executeSequential(
    executionOrder: string[],
    context: Omit<RuleContext, 'priorResults'>,
    result: ExecutionResult
  ): Promise<void> {
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
  }

  /**
   * Execute rules in parallel where dependencies allow
   */
  private async executeParallel(
    executionOrder: string[],
    context: Omit<RuleContext, 'priorResults'>,
    result: ExecutionResult
  ): Promise<void> {
    const completedRules = new Set<string>();
    const runningRules = new Set<string>();
    
    // Group rules by dependency levels for parallel execution
    const dependencyLevels = this.getDependencyLevels(executionOrder);
    
    for (const level of dependencyLevels) {
      // Execute all rules in this level in parallel
      const levelPromises = level.map(async (ruleId) => {
        // Wait for all dependencies to complete
        const dependencies = this.graph.getDependencies(ruleId);
        for (const dep of dependencies) {
          while (!completedRules.has(dep)) {
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        }

        try {
          const rule = this.rules.get(ruleId);
          if (!rule) {
            result.errors?.push({
              type: PipelineErrorType.RULE_EXECUTION_ERROR,
              message: `Rule '${ruleId}' not found in registry`,
            });
            return;
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
        } finally {
          completedRules.add(ruleId);
          runningRules.delete(ruleId);
        }
      });

      // Limit concurrency
      await this.executeWithConcurrencyLimit(levelPromises, this.maxConcurrency);
    }
  }

  /**
   * Execute promises with concurrency limit
   */
  private async executeWithConcurrencyLimit<T>(
    promises: Promise<T>[],
    limit: number
  ): Promise<T[]> {
    const results: T[] = [];
    const executing: Promise<void>[] = [];

    for (const promise of promises) {
      const p = Promise.resolve(promise).then(result => {
        results.push(result);
        executing.splice(executing.indexOf(p), 1);
      });

      executing.push(p);

      if (executing.length >= limit) {
        await Promise.race(executing);
      }
    }

    await Promise.all(executing);
    return results;
  }

  /**
   * Group rules by dependency levels for parallel execution
   */
  private getDependencyLevels(executionOrder: string[]): string[][] {
    const levels: string[][] = [];
    const processed = new Set<string>();
    const remaining = new Set(executionOrder);

    while (remaining.size > 0) {
      const currentLevel: string[] = [];
      
      for (const ruleId of remaining) {
        const dependencies = this.graph.getDependencies(ruleId);
        
        // Check if all dependencies are processed
        if (dependencies.every(dep => processed.has(dep))) {
          currentLevel.push(ruleId);
        }
      }

      if (currentLevel.length === 0) {
        // This should not happen if the graph is valid
        throw new Error('Circular dependency detected in parallel execution');
      }

      levels.push(currentLevel);
      
      // Mark as processed and remove from remaining
      currentLevel.forEach(ruleId => {
        processed.add(ruleId);
        remaining.delete(ruleId);
      });
    }

    return levels;
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
