# Policy Simulation Mode

## Overview

Policy Simulation Mode is a dry-run feature that allows developers to preview policy violations before actual contract deployment. This feature is part of the GasGuard production-readiness and long-term maintainability roadmap (Issue #1065).

## Features

- **Dry-Run Policy Analysis**: Evaluate contract code against policy rules without enforcing them
- **Violation Preview**: See potential policy violations before deployment
- **Configurable Rules**: Apply specific policy rules or all rules by default
- **Detailed Reports**: Get comprehensive violation reports with suggestions
- **Logging & Metrics**: Track policy simulation execution and results

## Architecture

### Rust Rule Engine (SorobanRuleEngine)

The Rust rule engine now supports simulation mode through:

- `simulation_mode` flag: Controls whether the engine operates in dry-run mode
- `set_simulation_mode()`: Enable or disable simulation mode
- `is_simulation_mode()`: Check current mode
- `analyze_simulation()`: Analyze code and return `PolicySimulationResult`

```rust
use gasguard_rules::soroban::{SorobanRuleEngine, PolicySimulationResult};

let mut engine = SorobanRuleEngine::with_default_rules();
engine.set_simulation_mode(true);

let result = engine.analyze_simulation(source_code, "contract.rs")?;
println!("Violations found: {}", result.violations.len());
```

### TypeScript Simulation Engine

The TypeScript simulation engine provides policy simulation capabilities:

- `setPolicySimulationMode()`: Configure simulation mode with options
- `isPolicySimulationMode()`: Check current mode
- `simulateWithPolicy()`: Execute simulation with policy analysis
- Built-in logging and metrics

```typescript
import { SimulationEngine, PolicySimulationConfig } from '@simulation/index';

const engine = new SimulationEngine(adapter);

const config: PolicySimulationConfig = {
  simulationMode: true,
  policyRules: ['auth-check', 'gas-optimization'],
  includePolicyDetails: true,
};

const result = await engine.simulateWithPolicy(code, method, params, config);
console.log('Policy violations:', result.policyViolations);
```

### API Endpoint

A new REST API endpoint for policy simulation:

**POST** `/api/simulation/policy-simulate`

Request body:
```json
{
  "code": "contract source code",
  "chain": "soroban",
  "method": "transfer",
  "params": ["param1", "param2"],
  "endpoints": [{"url": "http://localhost:8545", "weight": 1, "priority": 1}],
  "simulationMode": true,
  "policyRules": ["auth-check", "gas-optimization"],
  "includePolicyDetails": true
}
```

Response:
```json
{
  "success": true,
  "gasUsed": 100000,
  "isSimulation": true,
  "timestamp": 1696070400000,
  "policyViolations": [
    {
      "ruleId": "auth-check",
      "ruleName": "Authorization Check",
      "description": "Transfer function may be missing authorization",
      "severity": "error",
      "suggestion": "Add caller.require_auth() to ensure proper authorization",
      "lineNumber": 42
    }
  ]
}
```

## Configuration

### PolicySimulationConfig

```typescript
interface PolicySimulationConfig {
  /** Whether to enable policy simulation mode (dry-run) */
  simulationMode: boolean;
  /** Optional policy rules to apply during simulation */
  policyRules?: string[];
  /** Whether to include detailed policy violation reports */
  includePolicyDetails?: boolean;
}
```

### PolicySimulationResult

```typescript
interface PolicySimulationResult extends SimulationResult {
  /** Policy violations detected during simulation */
  policyViolations?: PolicyViolation[];
  /** Whether this is a simulation result */
  isSimulation: boolean;
  /** Simulation timestamp */
  timestamp: number;
}
```

### PolicyViolation

```typescript
interface PolicyViolation {
  /** Rule ID that was violated */
  ruleId: string;
  /** Rule name */
  ruleName: string;
  /** Description of the violation */
  description: string;
  /** Severity level */
  severity: 'error' | 'warning' | 'info';
  /** Suggested fix */
  suggestion: string;
  /** Line number where violation occurred */
  lineNumber?: number;
}
```

## Usage Examples

### CLI Usage

```bash
# Simulate with policy analysis
gasguard simulate --policy-mode contract.rs

# Simulate with specific rules
gasguard simulate --policy-mode --rules auth-check,gas-optimization contract.rs
```

### API Usage

```bash
curl -X POST http://localhost:3000/api/simulation/policy-simulate \
  -H "Content-Type: application/json" \
  -d '{
    "code": "contract source code",
    "chain": "soroban",
    "method": "transfer",
    "params": [],
    "simulationMode": true,
    "policyRules": ["auth-check"]
  }'
```

### Programmatic Usage (TypeScript)

```typescript
import { SimulationEngine } from '@simulation/index';
import { SorobanAdapter } from '@chains/index';
import { RpcClient } from '@rpc/index';

const rpcClient = new RpcClient([{ url: 'http://localhost:8545' }]);
const adapter = new SorobanAdapter(rpcClient);
const engine = new SimulationEngine(adapter);

const result = await engine.simulateWithPolicy(
  contractCode,
  'transfer',
  [fromAddress, toAddress, amount],
  {
    simulationMode: true,
    policyRules: ['auth-check', 'gas-optimization'],
  }
);

if (result.policyViolations && result.policyViolations.length > 0) {
  console.log('Policy violations found:');
  result.policyViolations.forEach(v => {
    console.log(`- ${v.ruleName}: ${v.description}`);
    console.log(`  Suggestion: ${v.suggestion}`);
  });
}
```

### Programmatic Usage (Rust)

```rust
use gasguard_rules::soroban::{SorobanRuleEngine, PolicySimulationResult};

let mut engine = SorobanRuleEngine::with_default_rules();
engine.set_simulation_mode(true);

let source_code = std::fs::read_to_string("contract.rs")?;
let result = engine.analyze_simulation(&source_code, "contract.rs")?;

println!("Simulation mode: {}", result.simulation_mode);
println!("Timestamp: {}", result.timestamp);
println!("Violations found: {}", result.violations.len());

for violation in &result.violations {
    println!("  - {}: {}", violation.rule_name, violation.description);
    println!("    Suggestion: {}", violation.suggestion);
}
```

## Logging and Metrics

### Logging

Policy simulation logs include:

- Simulation start timestamp
- Rules being applied
- Simulation completion timestamp
- Number of violations found
- Errors with context

Example log output:
```
[2024-09-30T10:30:00.000Z] Policy simulation started with rules: auth-check, gas-optimization
[2024-09-30T10:30:01.500Z] Policy simulation completed. Violations found: 2
```

### Metrics

The following metrics are emitted during policy simulation:

- `policy_violations_total`: Total number of violations found
- `policy_simulation_duration_ms`: Simulation execution time in milliseconds
- `policy_simulation_timestamp`: Unix timestamp of the simulation

## Testing

### Unit Tests

- `libs/simulation/simulation-engine.spec.ts`: Tests for TypeScript simulation engine
- `packages/rules/src/soroban/rule_engine.rs`: Tests for Rust rule engine simulation mode

### Integration Tests

- `apps/api/src/modules/simulation/simulation.routes.spec.ts`: Tests for API endpoint

### Running Tests

```bash
# Run TypeScript tests
npm test -- libs/simulation/simulation-engine.spec.ts

# Run Rust tests
cargo test --package gasguard-rules soroban::rule_engine::tests::test_simulation_mode
```

## Security Considerations

- Policy simulation mode is read-only and does not modify contracts
- No secrets or sensitive data are logged during simulation
- Simulation results are not persisted by default
- Policy rules are evaluated in isolation

## Backward Compatibility

This feature is fully backward compatible:

- Existing `analyze()` methods work unchanged
- Simulation mode is opt-in via explicit configuration
- Default behavior (non-simulation mode) is preserved
- No breaking changes to existing APIs

## Future Enhancements

Potential future improvements:

- Integration with actual Rust rule engine via FFI or IPC
- Policy rule editor UI
- Historical simulation results tracking
- Policy violation trend analysis
- Automated fix suggestions
- Integration with CI/CD pipelines

## Troubleshooting

### Common Issues

**Issue**: Simulation mode not detecting violations
- **Solution**: Ensure `simulationMode` is set to `true` in configuration

**Issue**: Specific policy rules not being applied
- **Solution**: Verify rule IDs are correct and the rules are registered in the engine

**Issue**: Logs not appearing
- **Solution**: Check log level configuration and ensure console output is enabled

## Related Issues

- #1065: Add policy simulation mode (this issue)
- #117: Claim expiration rule
- #118: Anti-front-running rule
- #119: Secure randomness rule
- #861-#864: Stellar Wave interface & call-safety rules

## References

- [GasGuard README](../README.md)
- [Soroban Rule Engine Documentation](../packages/rules/src/soroban/README.md)
- [Simulation Engine Documentation](../libs/simulation/README.md)
