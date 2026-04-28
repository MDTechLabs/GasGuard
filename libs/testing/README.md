# GasGuard Rule Testing Framework 🧪

> Testing utilities for rule developers with input/output fixtures and snapshot testing.

## Overview

The GasGuard Rule Testing Framework provides a comprehensive suite of tools for testing gas optimization and security rules. It supports both TypeScript (Solidity/Vyper) and Rust (Soroban) rules with:

- **Input/Output Fixtures**: JSON-based test cases with expected results
- **Snapshot Testing**: Track rule behavior changes over time
- **Assertion Helpers**: Rich assertion library for validating findings
- **Batch Testing**: Run multiple fixtures and generate reports
- **Cross-Language Support**: Works with TypeScript and Rust rules

## Installation

The testing framework is part of the GasGuard monorepo:

```bash
# TypeScript
npm install @gasguard/testing

# Rust (Cargo.toml)
[dev-dependencies]
gasguard-testing = { path = "libs/testing" }
```

## Quick Start

### TypeScript Example

```typescript
import { RuleTester, FixtureLoader, RuleAssertions } from '@gasguard/testing';
import { SolidityAnalyzer } from '@gasguard/engine';

// Create analyzer and tester
const analyzer = new SolidityAnalyzer();
await analyzer.initialize();

const tester = new RuleTester(analyzer, { verbose: true });

// Load and run a fixture
const fixture = FixtureLoader.loadFixture('./fixtures/sol-003.json');
const result = await tester.runFixture(fixture);

// Validate results
console.log(`Test ${result.passed ? 'PASSED' : 'FAILED'}`);
console.log(`Matched: ${result.matchedExpected.length}`);
console.log(`Missed: ${result.missedExpected.length}`);
```

### Rust Example

```rust
use gasguard_testing::{RuleFixture, RuleTestRunner, RuleAssertions};
use gasguard_rules::soroban::SorobanRuleEngine;

// Load fixture
let fixture = RuleFixture::from_file("fixtures/soroban-unused.json")?;

// Create runner
let runner = RuleTestRunner::new(true);

// Run test
let result = runner.run_fixture(&fixture, |source| {
    let mut engine = SorobanRuleEngine::new();
    engine.add_rule(UnusedStateVariablesRule::default());
    engine.analyze(source, "test.rs").unwrap_or_default()
});

assert!(result.passed);
```

## Core Components

### 1. RuleTester

The main testing engine that runs fixtures against analyzers.

```typescript
interface RuleTesterConfig {
  snapshotEnabled?: boolean;  // Enable snapshot testing
  snapshotDir?: string;       // Snapshot directory
  strict?: boolean;           // Fail on any mismatch
  verbose?: boolean;          // Log test details
}

const tester = new RuleTester(analyzer, {
  snapshotEnabled: true,
  verbose: true
});
```

**Key Methods:**
- `runFixture(fixture)`: Run a single test fixture
- `runFixtures(fixtures)`: Run multiple fixtures
- `runAll(fixtures)`: Run all and get summary
- `generateReport(results)`: Generate test report

### 2. FixtureLoader

Load and manage test fixtures from JSON files.

```typescript
// Load single fixture
const fixture = FixtureLoader.loadFixture('./path/to/fixture.json');

// Load all fixtures from directory
const fixtures = FixtureLoader.loadFixturesFromDir('./fixtures/');

// Load test suite
const suite = FixtureLoader.loadTestSuite('./suites/sol-003-suite.json');

// Create fixture programmatically
const fixture = FixtureLoader.createFixture(
  'unique-id',
  'Test Name',
  'Description',
  'contract Test {}',
  [{ ruleId: 'sol-001', severity: 'high' }]
);
```

### 3. SnapshotManager

Track and compare rule behavior over time.

```typescript
const snapshots = new SnapshotManager('./__snapshots__');

// Compare with snapshot
const comparison = snapshots.compareWithSnapshot(
  'sol-003',
  'test-case-1',
  actualFindings
);

if (!comparison.matches) {
  console.log(comparison.diff);
  
  // Update snapshot
  snapshots.updateSnapshot(
    'sol-003',
    'test-case-1',
    input,
    expectedFindings,
    actualFindings,
    true
  );
}
```

### 4. RuleAssertions

Rich assertion library for validating findings.

```typescript
// Basic assertions
RuleAssertions.assertHasFinding(findings, 'sol-003');
RuleAssertions.assertNotHasFinding(findings, 'sol-006');
RuleAssertions.assertFindingCount(findings, 2);

// Detailed assertions
RuleAssertions.assertFindingSeverity(findings, 'sol-003', 'medium');
RuleAssertions.assertFindingAtLine(findings, 'sol-003', 10, 1); // ±1 tolerance
RuleAssertions.assertFindingMessage(findings, 'sol-003', /cached/i);
RuleAssertions.assertMinGasSavings(findings, 500);
RuleAssertions.assertSeverityCount(findings, 'critical', 1);

// Match expected findings
RuleAssertions.assertMatchExpected(actualFindings, expectedFindings);
```

## Fixture Format

### TypeScript Fixtures

```json
{
  "id": "sol-003-uncached-array-1",
  "name": "Uncached Array Length in For Loop",
  "description": "Test that the rule detects array.length used directly in for loop",
  "input": "contract Test {\n  function foo() public {\n    for (uint i = 0; i < arr.length; i++) {}\n  }\n}",
  "expectedFindings": [
    {
      "ruleId": "sol-003",
      "severity": "medium",
      "messagePattern": "Array length is not cached",
      "line": 3,
      "estimatedGasSavings": 200
    }
  ],
  "metadata": {
    "language": "solidity",
    "category": "gas-optimization",
    "tags": ["loops", "arrays"]
  }
}
```

### Rust Fixtures

```json
{
  "id": "soroban-unused-var-1",
  "name": "Unused State Variable Detection",
  "description": "Test unused state variable detection",
  "input": "#[contracttype]\npub struct Contract {\n  pub unused: u64\n}",
  "expectedViolations": [
    {
      "rule_name": "soroban-unused-state-variables",
      "severity": "Warning",
      "message_pattern": "unused",
      "line_number": 3
    }
  ],
  "metadata": {
    "language": "soroban",
    "category": "gas-optimization"
  }
}
```

## Test Suite Format

Group related fixtures into test suites:

```json
{
  "ruleId": "sol-003",
  "name": "Uncached Array Length Rule Tests",
  "description": "Complete test suite for sol-003",
  "fixtures": [
    {
      "id": "positive-test",
      "name": "Detects uncached array",
      "input": "...",
      "expectedFindings": [...]
    },
    {
      "id": "negative-test",
      "name": "Does not flag cached array",
      "input": "...",
      "expectedFindings": []
    }
  ]
}
```

## Directory Structure

```
tests/rules/
├── fixtures/              # Individual test fixtures
│   ├── sol-003-uncached-array.json
│   ├── sol-006-reentrancy.json
│   └── soroban-unused-variable.json
├── suites/                # Test suite collections
│   └── sol-003-suite.json
├── __snapshots__/         # Snapshot files (auto-generated)
│   └── sol-003/
│       └── test-case-1.json
├── solidity-rules.spec.ts # TypeScript tests
└── soroban_rules_test.rs  # Rust tests
```

## Writing Tests

### Basic Test

```typescript
describe('sol-003: Uncached Array Length', () => {
  it('should detect uncached array.length', async () => {
    const fixture = FixtureLoader.loadFixture('./fixtures/sol-003.json');
    const result = await tester.runFixture(fixture);
    
    expect(result.passed).toBe(true);
    expect(result.matchedExpected.length).toBe(1);
  });
});
```

### Negative Test

```typescript
it('should NOT flag optimized code', async () => {
  const code = `
    contract Optimized {
      function foo() public {
        uint len = arr.length;
        for (uint i = 0; i < len; i++) {}
      }
    }
  `;
  
  const result = await analyzer.analyze(code, 'optimized.sol');
  RuleAssertions.assertNotHasFinding(result.findings, 'sol-003');
});
```

### Batch Test

```typescript
it('should run all fixtures', async () => {
  const fixtures = FixtureLoader.loadFixturesFromDir('./fixtures/');
  const summary = await tester.runAll(fixtures);
  
  console.log(tester.generateReport(summary.results));
  
  expect(summary.failed).toBe(0);
});
```

## Running Tests

### TypeScript Tests

```bash
# Run all tests
npm test

# Run rule tests only
npm test -- tests/rules/*.spec.ts

# Run with coverage
npm test -- --coverage tests/rules/

# Watch mode
npm run test:watch
```

### Rust Tests

```bash
# Run all tests
cargo test

# Run specific test
cargo test test_unused_state_variables

# Run with output
cargo test -- --nocapture

# Run tests in testing library
cargo test -p gasguard-testing
```

## Best Practices

### 1. One Finding Per Fixture

Test one specific finding per fixture for clarity:

```json
{
  "id": "sol-003-test-1",
  "name": "Single uncached array",
  "expectedFindings": [
    { "ruleId": "sol-003", ... }
  ]
}
```

### 2. Include Negative Tests

Always test cases where the rule should NOT trigger:

```json
{
  "id": "sol-003-negative",
  "name": "Cached array (no violation)",
  "expectedFindings": []
}
```

### 3. Use Descriptive Names

Make fixture names self-documenting:

```json
{
  "name": "Nested loop with uncached outer array",
  "description": "Tests detection of uncached array.length in outer loop of nested structure"
}
```

### 4. Include Metadata

Tag fixtures for better organization:

```json
{
  "metadata": {
    "language": "solidity",
    "category": "gas-optimization",
    "tags": ["loops", "arrays", "nested"],
    "difficulty": "intermediate"
  }
}
```

### 5. Snapshot Critical Tests

Use snapshots for complex rules to detect regressions:

```typescript
const tester = new RuleTester(analyzer, {
  snapshotEnabled: true,
  snapshotDir: './__snapshots__'
});
```

## Advanced Features

### Custom Assertions

Create domain-specific assertions:

```typescript
class SolidityAssertions extends RuleAssertions {
  static assertReentrancyGuard(findings: Finding[], functionName: string) {
    this.assertHasFinding(
      findings,
      'sol-006',
      `Function ${functionName} should have reentrancy guard`
    );
  }
}
```

### Fixture Generation

Generate fixtures from existing code:

```typescript
const fixture = FixtureLoader.createFixture(
  'auto-generated-1',
  'Auto-generated test',
  'Generated from code sample',
  contractCode,
  expectedFindings
);

FixtureLoader.saveFixture(fixture, './fixtures/new-test.json');
```

### CI/CD Integration

```yaml
# .github/workflows/test-rules.yml
name: Test Rules
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm install
      - run: npm test -- tests/rules/
      - run: cargo test -p gasguard-testing
```

## API Reference

### TypeScript

| Class | Description |
|-------|-------------|
| `RuleTester` | Main testing engine |
| `FixtureLoader` | Load/save fixtures |
| `SnapshotManager` | Snapshot testing |
| `RuleAssertions` | Assertion helpers |

### Rust

| Struct | Description |
|--------|-------------|
| `RuleTestRunner` | Main testing engine |
| `RuleFixture` | Test fixture definition |
| `TestSuite` | Fixture collection |
| `RuleAssertions` | Assertion helpers |

## Contributing

1. Add fixtures in `tests/rules/fixtures/`
2. Create test suites in `tests/rules/suites/`
3. Write tests in `tests/rules/*.spec.ts` or `tests/rules/*_test.rs`
4. Run tests: `npm test && cargo test`
5. Update documentation

## License

MIT
