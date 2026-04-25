/**
 * Example implementations demonstrating rule dependencies
 * Shows how to build rules that leverage prior analysis context
 */

import { BaseRule, RuleContext, RuleViolation } from './index';

/**
 * Example 1: Pattern detection rule (no dependencies)
 * First pass - identifies gas-inefficient patterns
 */
export class GasPatternDetectionRule extends BaseRule {
  id = 'gas-pattern-detection';
  name = 'Gas Pattern Detection';
  description = 'Identifies common gas-inefficient patterns in the code';

  async analyze(context: RuleContext): Promise<RuleViolation[]> {
    const violations: RuleViolation[] = [];

    // Example: Detect inefficient loop patterns
    if (context.ast?.functions) {
      for (const func of context.ast.functions) {
        if (func.hasUnoptimizedLoop) {
          violations.push({
            ruleId: this.id,
            type: 'gas-inefficient-loop',
            severity: 'high',
            message: 'Function has unoptimized loop',
            location: {
              file: context.ast.fileName,
              line: func.line,
            },
            metadata: {
              functionName: func.name,
              estimatedGasIncrease: 500,
            },
          });
        }
      }
    }

    return violations;
  }

  generateOutput(violations: RuleViolation[]): Record<string, any> {
    const patterns = violations.map((v) => ({ type: v.type, location: v.location }));

    return {
      patternsFound: violations.length,
      patterns,
      estimatedTotalGasIncrease: violations.reduce(
        (sum, v) => sum + (v.metadata?.estimatedGasIncrease || 0),
        0,
      ),
    };
  }
}

/**
 * Example 2: Context analysis rule (depends on pattern detection)
 * Second pass - analyzes context around detected patterns
 */
export class ContextAnalysisRule extends BaseRule {
  id = 'context-analysis';
  name = 'Context Analysis';
  description = 'Analyzes context around detected patterns';

  getDependencies(): string[] {
    return ['gas-pattern-detection'];
  }

  async analyze(context: RuleContext): Promise<RuleViolation[]> {
    const violations: RuleViolation[] = [];

    // Get results from prior rule
    const priorOutput = this.getPriorOutput('gas-pattern-detection', context);
    if (!priorOutput?.patterns) {
      return violations;
    }

    // Analyze context for each detected pattern
    for (const pattern of priorOutput.patterns) {
      // Example: Check if pattern is in a time-sensitive function
      if (context.ast?.functions) {
        const funcAtLocation = context.ast.functions.find(
          (f) => f.line === pattern.location?.line,
        );

        if (funcAtLocation?.isTimeSensitive) {
          violations.push({
            ruleId: this.id,
            type: 'context-critical-pattern',
            severity: 'critical',
            message: 'Gas-inefficient pattern found in time-sensitive function',
            location: pattern.location,
            metadata: {
              functionName: funcAtLocation.name,
              urgency: 'high',
            },
          });
        }
      }
    }

    return violations;
  }

  generateOutput(violations: RuleViolation[]): Record<string, any> {
    return {
      contextAnalyzed: true,
      criticalPatterns: violations.filter((v) => v.severity === 'critical').length,
      violations,
    };
  }
}

/**
 * Example 3: Optimization recommendation rule
 * Third pass - uses context analysis to recommend optimizations
 */
export class OptimizationRecommendationRule extends BaseRule {
  id = 'optimization-recommendations';
  name = 'Optimization Recommendations';
  description = 'Recommends specific optimizations based on analysis';

  getDependencies(): string[] {
    return ['gas-pattern-detection', 'context-analysis'];
  }

  async analyze(context: RuleContext): Promise<RuleViolation[]> {
    const violations: RuleViolation[] = [];

    // Get results from prior rules
    const patternOutput = this.getPriorOutput('gas-pattern-detection', context);
    const contextOutput = this.getPriorOutput('context-analysis', context);

    if (patternOutput?.patternsFound === 0) {
      return violations;
    }

    // Generate recommendations based on combined context
    const totalGasIncrease = patternOutput?.estimatedTotalGasIncrease || 0;
    const criticalCount = contextOutput?.criticalPatterns || 0;

    violations.push({
      ruleId: this.id,
      type: 'optimization-recommendation',
      severity: 'info',
      message: `Found ${patternOutput?.patternsFound} patterns with ${totalGasIncrease}+ estimated gas increase`,
      metadata: {
        criticalPatterns: criticalCount,
        recommendations: [
          {
            pattern: 'unoptimized-loop',
            suggestion: 'Use cached length in loop conditions',
            estimatedSavings: 200,
          },
          {
            pattern: 'redundant-computation',
            suggestion: 'Cache computed values',
            estimatedSavings: 150,
          },
        ],
        totalPotentialSavings: 350,
      },
    });

    return violations;
  }
}

/**
 * Example 4: Complex multi-level dependency
 * Shows how to build sophisticated analysis chains
 */
export class CostOptimizationRule extends BaseRule {
  id = 'cost-optimization';
  name = 'Cost Optimization';
  description = 'Final optimization analysis using all prior results';

  getDependencies(): string[] {
    return ['optimization-recommendations'];
  }

  async analyze(context: RuleContext): Promise<RuleViolation[]> {
    const recommendations = this.getPriorOutput('optimization-recommendations', context);

    if (!recommendations) {
      return [];
    }

    // Use all prior analysis to make final recommendations
    const recommendations_list = recommendations.metadata?.recommendations || [];
    const prioritized = recommendations_list.sort(
      (a: any, b: any) => (b.estimatedSavings || 0) - (a.estimatedSavings || 0),
    );

    return [
      {
        ruleId: this.id,
        type: 'final-recommendations',
        severity: 'info',
        message: 'Cost optimization recommendations',
        metadata: {
          prioritizedRecommendations: prioritized,
          totalSavingsPotential: recommendations.metadata?.totalPotentialSavings,
          implementationOrder: prioritized.map((r: any) => r.pattern),
        },
      },
    ];
  }
}

/**
 * Example usage showing how rules with dependencies work together
 */
export async function demonstrateRuleDependencies(): Promise<void> {
  const { PipelineExecutor } = await import('./index');

  // Create pipeline with dependency chain
  const executor = new PipelineExecutor();

  executor.registerRules([
    new GasPatternDetectionRule(),
    new ContextAnalysisRule(),
    new OptimizationRecommendationRule(),
    new CostOptimizationRule(),
  ]);

  // Validate execution order
  console.log('Dependency chain:');
  const order = executor.getExecutionOrder();
  console.log(`  ${order?.join(' → ')}`);

  // Mock AST
  const mockAST = {
    fileName: 'contract.sol',
    functions: [
      {
        name: 'transfer',
        line: 10,
        hasUnoptimizedLoop: true,
        isTimeSensitive: true,
      },
      {
        name: 'batchTransfer',
        line: 25,
        hasUnoptimizedLoop: true,
        isTimeSensitive: false,
      },
    ],
  };

  // Execute pipeline
  const result = await executor.execute({ ast: mockAST });

  console.log('\nExecution Results:');
  console.log(`  Success: ${result.success}`);
  console.log(`  Total violations: ${result.allViolations.length}`);
  console.log(`  Execution time: ${result.executionTime}ms`);
  console.log(`  Rules executed: ${result.executionOrder.length}`);

  // Show how each rule builds on prior results
  console.log('\nRule Output Chain:');
  for (const ruleId of result.executionOrder) {
    const ruleResult = result.ruleResults.get(ruleId);
    console.log(`  ${ruleId}:`);
    console.log(`    - Violations: ${ruleResult?.violations.length || 0}`);
    console.log(`    - Output keys: ${Object.keys(ruleResult?.output || {}).join(', ')}`);
  }
}
