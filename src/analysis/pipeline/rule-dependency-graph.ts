/**
 * Dependency graph manager for rule execution ordering
 * Handles cycle detection, topological sorting, and dependency validation
 */

import { PipelineErrorType, IPipelineError } from './types';

export class RuleDependencyGraph {
  private dependencies: Map<string, Set<string>> = new Map();
  private allRuleIds: Set<string> = new Set();

  constructor() {}

  /**
   * Add a rule and its dependencies to the graph
   */
  addRule(ruleId: string, dependsOn: string[] = []): void {
    if (this.allRuleIds.has(ruleId)) {
      throw this.createError(
        PipelineErrorType.DUPLICATE_RULE_ID,
        `Rule '${ruleId}' is already registered`,
      );
    }

    this.allRuleIds.add(ruleId);
    this.dependencies.set(ruleId, new Set(dependsOn));
  }

  /**
   * Validate the dependency graph for issues
   */
  validate(): IPipelineError[] {
    const errors: IPipelineError[] = [];

    // Check for missing dependencies
    for (const [ruleId, deps] of this.dependencies.entries()) {
      for (const dep of deps) {
        if (!this.allRuleIds.has(dep)) {
          errors.push(
            this.createError(
              PipelineErrorType.MISSING_DEPENDENCY,
              `Rule '${ruleId}' depends on '${dep}' which is not registered`,
              { ruleId, missingDependency: dep },
            ),
          );
        }
      }
    }

    // Check for circular dependencies
    for (const ruleId of this.allRuleIds) {
      const cycle = this.detectCycle(ruleId);
      if (cycle) {
        errors.push(
          this.createError(
            PipelineErrorType.CIRCULAR_DEPENDENCY,
            `Circular dependency detected: ${cycle.join(' -> ')}`,
            { cycle },
          ),
        );
      }
    }

    return errors;
  }

  /**
   * Detect if a rule is part of a circular dependency
   */
  private detectCycle(startRuleId: string): string[] | null {
    const visited = new Set<string>();
    const path: string[] = [];

    const dfs = (ruleId: string): boolean => {
      if (path.includes(ruleId)) {
        // Found cycle - return path from cycle start
        const cycleStart = path.indexOf(ruleId);
        path.push(ruleId); // Complete the cycle
        return true;
      }

      if (visited.has(ruleId)) {
        return false;
      }

      visited.add(ruleId);
      path.push(ruleId);

      const deps = this.dependencies.get(ruleId);
      if (deps) {
        for (const dep of deps) {
          if (dfs(dep)) {
            return true;
          }
        }
      }

      path.pop();
      return false;
    };

    if (dfs(startRuleId)) {
      return path;
    }

    return null;
  }

  /**
   * Get rules in topologically sorted order (respecting dependencies)
   * Returns null if graph has cycles
   */
  topologicalSort(): string[] | null {
    // Validate first
    const errors = this.validate();
    if (
      errors.some((e) => e.type === PipelineErrorType.CIRCULAR_DEPENDENCY)
    ) {
      return null;
    }

    const visited = new Set<string>();
    const sorted: string[] = [];

    const dfs = (ruleId: string): void => {
      if (visited.has(ruleId)) {
        return;
      }

      visited.add(ruleId);

      // Visit dependencies first
      const deps = this.dependencies.get(ruleId);
      if (deps) {
        for (const dep of deps) {
          dfs(dep);
        }
      }

      sorted.push(ruleId);
    };

    // Process all rules
    for (const ruleId of this.allRuleIds) {
      dfs(ruleId);
    }

    return sorted;
  }

  /**
   * Get direct dependencies of a rule
   */
  getDependencies(ruleId: string): string[] {
    return Array.from(this.dependencies.get(ruleId) || []);
  }

  /**
   * Get all transitive dependencies of a rule
   */
  getAllTransitiveDependencies(ruleId: string): Set<string> {
    const deps = new Set<string>();
    const queue = [ruleId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const directDeps = this.dependencies.get(current);

      if (directDeps) {
        for (const dep of directDeps) {
          if (!deps.has(dep)) {
            deps.add(dep);
            queue.push(dep);
          }
        }
      }
    }

    return deps;
  }

  private createError(
    type: PipelineErrorType,
    message: string,
    details?: any,
  ): IPipelineError {
    return { type, message, details };
  }
}
