# Rule Dependency System

## Overview

The Rule Dependency System enables rules to depend on outputs of other rules, allowing sophisticated multi-stage analysis pipelines where later rules can leverage context from earlier analysis phases.

## Problem Solved

**Without dependencies:** Rules execute independently, unable to use optimizations from prior analysis.

**With dependencies:** Rules can:
- Depend on outputs of other rules
- Execute in correct order automatically
- Share analysis context (e.g., detected patterns)
- Build sophisticated analysis chains

## Architecture

### Core Components

#### 1. **Types** (`types.ts`)
- `IRule`: Contract for all pipeline rules
- `RuleResult`: Result from rule execution
- `RuleViolation`: Individual violation report
- `RuleContext`: Context passed between rules
- `ExecutionResult`: Complete pipeline execution result

#### 2. **RuleDependencyGraph** (`rule-dependency-graph.ts`)
Manages dependencies and ensures correct execution order:
- Validates graph integrity
- Detects circular dependencies
- Performs topological sorting
- Resolves transitive dependencies

#### 3. **PipelineExecutor** (`pipeline-executor.ts`)
Orchestrates rule execution:
- Registers rules
- Validates pipeline
- Executes rules in dependency order
- Passes context between rules
- Handles errors gracefully

#### 4. **BaseRule** (`base-rule.ts`)
Abstract base class for implementing rules:
- Simplifies rule creation
- Provides helper methods for accessing prior results
- Standardizes rule interface

## Usage

### Creating a Simple Rule (No Dependencies)

```typescript
import { BaseRule, RuleContext, RuleViolation } from '@gasguard/pipeline';

class PatternDetectionRule extends BaseRule {
  id = 'pattern-detection';
  name = 'Pattern Detection';
  description = 'Detects gas-inefficient patterns';

  async analyze(context: RuleContext): Promise<RuleViolation[]> {
    // Analyze and return violations
    return [/* violations */];
  }

  generateOutput(violations: RuleViolation[]): Record<string, any> {
    // Generate structured output for dependent rules
    return { patternCount: violations.length };
  }
}
```

### Creating a Rule with Dependencies

```typescript
class OptimizationRule extends BaseRule {
  id = 'optimization';
  name = 'Optimization';
  description = 'Recommends optimizations based on patterns';

  getDependencies(): string[] {
    return ['pattern-detection']; // Depends on pattern detection
  }

  async analyze(context: RuleContext): Promise<RuleViolation[]> {
    // Access prior rule output
    const patterns = this.getPriorOutput('pattern-detection', context);
    
    // Use patterns in analysis
    return [/* violations based on patterns */];
  }
}
```

### Setting Up the Pipeline

```typescript
import { PipelineExecutor } from '@gasguard/pipeline';

const executor = new PipelineExecutor();

// Register rules
executor.registerRules([
  new PatternDetectionRule(),
  new AnalysisRule(),
  new OptimizationRule(),
]);

// Validate pipeline
if (!executor.validate()) {
  console.error('Pipeline validation failed:', executor.getValidationErrors());
}

// Execute pipeline
const result = await executor.execute({
  ast: myAST,
  config: { /* config */ },
});

console.log(`Found ${result.allViolations.length} violations`);
console.log(`Execution order: ${result.executionOrder.join(' → ')}`);
console.log(`Time: ${result.executionTime}ms`);
```

## Execution Order Resolution

The system uses **topological sorting** to automatically determine execution order:

```
Pattern Detection (no deps)
        ↓
Context Analysis (depends on Pattern Detection)
        ↓
Optimization (depends on Pattern Detection, Context Analysis)
        ↓
Cost Optimization (depends on Optimization)
```

## Error Handling

### Circular Dependencies
```typescript
graph.addRule('a', ['b']);
graph.addRule('b', ['a']); // Circular!

const errors = graph.validate();
// Error: Circular dependency detected: a -> b -> a
```

### Missing Dependencies
```typescript
graph.addRule('a', ['nonexistent-rule']);

const errors = graph.validate();
// Error: Rule 'a' depends on 'nonexistent-rule' which is not registered
```

### Execution Errors
```typescript
const result = await executor.execute({ ast });
if (!result.success) {
  console.error('Execution failed:', result.errors);
}
```

## Features

### 1. Topological Sorting
- Automatically determines correct execution order
- Respects all transitive dependencies
- Ensures circular dependencies are caught before execution

### 2. Dependency Graph Analysis
```typescript
// Get direct dependencies
const deps = graph.getDependencies('rule-id');

// Get all transitive dependencies
const allDeps = graph.getAllTransitiveDependencies('rule-id');
```

### 3. Selective Execution
Execute only a specific rule and its dependencies:
```typescript
const result = await executor.executeRule('final-rule', { ast });
// Automatically includes all transitive dependencies
```

### 4. Context Passing
Rules receive results from prior rules:
```typescript
const priorResult = this.getPriorResult('prior-rule', context);
const priorOutput = this.getPriorOutput<OutputType>('prior-rule', context);
```

### 5. Detailed Execution Metrics
```typescript
console.log(`Execution order: ${result.executionOrder}`);
console.log(`Execution time: ${result.executionTime}ms`);
console.log(`Rules executed: ${result.ruleResults.size}`);
```

## Example Use Cases

### Use Case 1: Multi-Stage Gas Analysis

**Stage 1: Pattern Detection**
- Identify common gas-inefficient patterns
- Output: List of patterns and their locations

**Stage 2: Context Analysis**
- Analyze context around each pattern
- Use: Prior pattern detection results
- Output: Severity classification of patterns

**Stage 3: Optimization Recommendation**
- Recommend specific optimizations
- Use: Pattern list and context analysis
- Output: Prioritized recommendations

**Stage 4: Cost Analysis**
- Calculate total savings potential
- Use: Prior recommendations
- Output: Implementation roadmap

### Use Case 2: Reentrancy Detection

**Stage 1: External Call Detection**
- Find all external calls
- Output: Call graph and locations

**Stage 2: State Mutation Analysis**
- Find all state mutations
- Use: External call locations
- Output: Mutation points and external calls

**Stage 3: Reentrancy Vulnerability Detection**
- Check for reentrancy patterns
- Use: Call graph and mutation analysis
- Output: Vulnerability reports

## Performance Considerations

### Benefits
- ✅ Eliminates redundant analysis (reuse prior results)
- ✅ Enables complex optimizations impossible with independent rules
- ✅ Automatic execution ordering (no manual sequencing)
- ✅ Early exit on first error (if rules depend on it)

### Overhead
- Small: Topological sort is O(V + E) where V = rules, E = dependencies
- Context passing is O(n) where n = prior results

## Testing

Run comprehensive tests:

```bash
npx ts-node src/analysis/pipeline/pipeline.test.ts
```

Tests cover:
- ✅ Dependency graph validation
- ✅ Circular dependency detection
- ✅ Topological sorting
- ✅ Pipeline execution
- ✅ Context passing
- ✅ Error handling
- ✅ Transitive dependencies

## API Reference

### PipelineExecutor

```typescript
class PipelineExecutor {
  // Register rules
  registerRule(rule: IRule): void
  registerRules(rules: IRule[]): void

  // Validation
  validate(): boolean
  getValidationErrors(): IPipelineError[]

  // Execution
  execute(context: RuleContext): Promise<ExecutionResult>
  executeRule(ruleId: string, context: RuleContext): Promise<ExecutionResult>

  // Inspection
  getExecutionOrder(): string[] | null
}
```

### BaseRule

```typescript
abstract class BaseRule implements IRule {
  // Required implementation
  abstract analyze(context: RuleContext): Promise<RuleViolation[]>

  // Optional overrides
  getDependencies(): string[]
  generateOutput(violations: RuleViolation[]): Record<string, any>

  // Helpers
  protected getPriorResult(ruleId: string, context: RuleContext): RuleResult
  protected getPriorOutput<T>(ruleId: string, context: RuleContext): T
}
```

### RuleDependencyGraph

```typescript
class RuleDependencyGraph {
  addRule(ruleId: string, dependsOn: string[]): void
  validate(): IPipelineError[]
  topologicalSort(): string[] | null
  getDependencies(ruleId: string): string[]
  getAllTransitiveDependencies(ruleId: string): Set<string>
}
```

## Acceptance Criteria

✅ **Dependencies resolved correctly**
- All dependencies properly identified
- Topological sort produces valid ordering
- Transitive dependencies handled

✅ **Correct execution order**
- Rules execute in dependency-respecting order
- No rule executes before its dependencies
- Context correctly passed between rules

✅ **Error detection**
- Circular dependencies detected
- Missing dependencies reported
- Execution errors captured

✅ **Performance**
- Efficient topological sort
- Minimal context passing overhead
- Fast validation

## Future Enhancements

- [ ] Parallel rule execution (for independent rules)
- [ ] Caching of rule results
- [ ] Conditional dependency resolution
- [ ] Rule priority/weighting
- [ ] Dynamic rule registration
- [ ] Streaming rule results
