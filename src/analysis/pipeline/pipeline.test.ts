/**
 * Tests for rule dependency pipeline system
 */

import {
  RuleDependencyGraph,
  PipelineExecutor,
  BaseRule,
  RuleContext,
  RuleViolation,
  ExecutionResult,
  PipelineErrorType,
} from './index';

/**
 * Test: Dependency graph validation and topological sorting
 */
export async function testDependencyGraphBasics(): Promise<void> {
  console.log('Testing dependency graph basics...');

  const graph = new RuleDependencyGraph();

  // Add rules with dependencies
  graph.addRule('rule-a', []); // No dependencies
  graph.addRule('rule-b', ['rule-a']); // Depends on rule-a
  graph.addRule('rule-c', ['rule-a', 'rule-b']); // Depends on a and b

  // Validate
  const errors = graph.validate();
  if (errors.length > 0) {
    throw new Error(`Unexpected validation errors: ${JSON.stringify(errors)}`);
  }

  // Get topological sort
  const sorted = graph.topologicalSort();
  if (!sorted) {
    throw new Error('Failed to get topological sort');
  }

  // Verify order
  const aIndex = sorted.indexOf('rule-a');
  const bIndex = sorted.indexOf('rule-b');
  const cIndex = sorted.indexOf('rule-c');

  if (aIndex > bIndex || bIndex > cIndex) {
    throw new Error(`Invalid topological order: ${sorted}`);
  }

  console.log(`✓ Topological sort correct: ${sorted}`);
}

/**
 * Test: Circular dependency detection
 */
export async function testCircularDependencyDetection(): Promise<void> {
  console.log('Testing circular dependency detection...');

  const graph = new RuleDependencyGraph();

  // Create circular dependency: a -> b -> c -> a
  graph.addRule('rule-a', ['rule-c']);
  graph.addRule('rule-b', ['rule-a']);
  graph.addRule('rule-c', ['rule-b']);

  const errors = graph.validate();
  const circularErrors = errors.filter(
    (e) => e.type === PipelineErrorType.CIRCULAR_DEPENDENCY,
  );

  if (circularErrors.length === 0) {
    throw new Error('Circular dependency not detected');
  }

  console.log(`✓ Circular dependency detected: ${circularErrors[0].message}`);
}

/**
 * Test: Missing dependency detection
 */
export async function testMissingDependencyDetection(): Promise<void> {
  console.log('Testing missing dependency detection...');

  const graph = new RuleDependencyGraph();

  graph.addRule('rule-a', ['nonexistent-rule']);

  const errors = graph.validate();
  const missingErrors = errors.filter(
    (e) => e.type === PipelineErrorType.MISSING_DEPENDENCY,
  );

  if (missingErrors.length === 0) {
    throw new Error('Missing dependency not detected');
  }

  console.log(`✓ Missing dependency detected: ${missingErrors[0].message}`);
}

/**
 * Test: Pipeline execution with dependencies
 */
export async function testPipelineExecution(): Promise<void> {
  console.log('Testing pipeline execution with dependencies...');

  // Create test rules
  class TestRuleA extends BaseRule {
    id = 'test-a';
    name = 'Test Rule A';
    description = 'Base rule with no dependencies';

    async analyze(context: RuleContext): Promise<RuleViolation[]> {
      return [
        {
          ruleId: this.id,
          type: 'test',
          severity: 'info',
          message: 'Rule A executed',
        },
      ];
    }

    generateOutput(violations: RuleViolation[]): Record<string, any> {
      return { checkedGasPatterns: true, patternCount: 42 };
    }
  }

  class TestRuleB extends BaseRule {
    id = 'test-b';
    name = 'Test Rule B';
    description = 'Rule that depends on A';

    getDependencies(): string[] {
      return ['test-a'];
    }

    async analyze(context: RuleContext): Promise<RuleViolation[]> {
      const priorOutput = this.getPriorOutput('test-a', context);
      if (!priorOutput || !priorOutput.checkedGasPatterns) {
        throw new Error('Prior rule output not available');
      }

      return [
        {
          ruleId: this.id,
          type: 'test',
          severity: 'info',
          message: `Rule B executed (found ${priorOutput.patternCount} patterns)`,
        },
      ];
    }
  }

  // Create executor
  const executor = new PipelineExecutor();
  executor.registerRules([new TestRuleA(), new TestRuleB()]);

  // Validate
  if (!executor.validate()) {
    throw new Error(`Validation failed: ${JSON.stringify(executor.getValidationErrors())}`);
  }

  // Get execution order
  const order = executor.getExecutionOrder();
  if (!order || order[0] !== 'test-a' || order[1] !== 'test-b') {
    throw new Error(`Incorrect execution order: ${order}`);
  }

  // Execute
  const result = await executor.execute({ ast: null });

  if (!result.success) {
    throw new Error(`Execution failed: ${JSON.stringify(result.errors)}`);
  }

  if (result.allViolations.length !== 2) {
    throw new Error(`Expected 2 violations, got ${result.allViolations.length}`);
  }

  console.log(`✓ Pipeline executed successfully`);
  console.log(`  - Order: ${result.executionOrder.join(' -> ')}`);
  console.log(`  - Violations: ${result.allViolations.length}`);
  console.log(`  - Time: ${result.executionTime}ms`);
}

/**
 * Test: Single rule execution with dependencies
 */
export async function testSingleRuleExecution(): Promise<void> {
  console.log('Testing single rule execution with dependencies...');

  class RuleX extends BaseRule {
    id = 'rule-x';
    name = 'Rule X';
    description = 'Base rule';

    async analyze(): Promise<RuleViolation[]> {
      return [{ ruleId: this.id, type: 'test', severity: 'info', message: 'X' }];
    }

    generateOutput(): Record<string, any> {
      return { result: 'X' };
    }
  }

  class RuleY extends BaseRule {
    id = 'rule-y';
    name = 'Rule Y';
    description = 'Depends on X';

    getDependencies(): string[] {
      return ['rule-x'];
    }

    async analyze(): Promise<RuleViolation[]> {
      return [{ ruleId: this.id, type: 'test', severity: 'info', message: 'Y' }];
    }
  }

  class RuleZ extends BaseRule {
    id = 'rule-z';
    name = 'Rule Z';
    description = 'Depends on Y';

    getDependencies(): string[] {
      return ['rule-y'];
    }

    async analyze(): Promise<RuleViolation[]> {
      return [{ ruleId: this.id, type: 'test', severity: 'info', message: 'Z' }];
    }
  }

  const executor = new PipelineExecutor();
  executor.registerRules([new RuleX(), new RuleY(), new RuleZ()]);

  // Execute only rule-z (should include x and y)
  const result = await executor.executeRule('rule-z', { ast: null });

  if (!result.success) {
    throw new Error('Execution failed');
  }

  // Should execute all three rules
  if (result.executionOrder.length !== 3) {
    throw new Error(
      `Expected 3 rules in execution order, got ${result.executionOrder.length}`,
    );
  }

  console.log(`✓ Single rule execution with dependencies worked`);
  console.log(`  - Executed: ${result.executionOrder.join(' -> ')}`);
}

/**
 * Test: Transitive dependency resolution
 */
export async function testTransitiveDependencies(): Promise<void> {
  console.log('Testing transitive dependency resolution...');

  const graph = new RuleDependencyGraph();

  graph.addRule('base', []);
  graph.addRule('level1', ['base']);
  graph.addRule('level2', ['level1']);
  graph.addRule('level3', ['level2']);

  const deps = graph.getAllTransitiveDependencies('level3');

  if (deps.size !== 3 || !deps.has('base') || !deps.has('level1') || !deps.has('level2')) {
    throw new Error(`Incorrect transitive dependencies: ${Array.from(deps)}`);
  }

  console.log(`✓ Transitive dependencies resolved correctly: ${Array.from(deps).join(', ')}`);
}

/**
 * Run all tests
 */
export async function runAllTests(): Promise<void> {
  const tests = [
    testDependencyGraphBasics,
    testCircularDependencyDetection,
    testMissingDependencyDetection,
    testPipelineExecution,
    testSingleRuleExecution,
    testTransitiveDependencies,
  ];

  console.log('🧪 Running rule dependency tests...\n');

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      await test();
      passed++;
    } catch (error) {
      failed++;
      console.error(`✗ ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

// Run tests if executed directly
if (require.main === module) {
  runAllTests().catch((error) => {
    console.error('Test suite failed:', error);
    process.exit(1);
  });
}
